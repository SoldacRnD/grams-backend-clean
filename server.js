const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const SupabaseDB = require('./db/supabase'); // using Supabase now
const newId = require('./utils/id');

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const app = express();
app.use(cors());
app.use(bodyParser.json());

const upload = multer({ storage: multer.memoryStorage() });

const db = new SupabaseDB();

// Serve producer web UI
app.use('/producer', express.static(path.join(__dirname, 'producer-ui')));

// -----------------------------------------------------------------------------
// List grams by owner (used by "My Grams" page)
// -----------------------------------------------------------------------------
app.get('/api/grams', async (req, res) => {
  const ownerId = req.query.ownerId;
  if (!ownerId) {
    return res.status(400).json({ error: 'ownerId required' });
  }

  try {
    const grams = await db.getGramsByOwner(ownerId);
    return res.json(grams);
  } catch (err) {
    console.error('Error fetching grams by owner:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------------------------------------------------------
// Get a single Gram by NFC tag (used by NFC / ?tag=ABC123)
// -----------------------------------------------------------------------------
app.get('/api/grams/by-tag', async (req, res) => {
  const tagId = req.query.nfcTagId;
  if (!tagId) {
    return res.status(400).json({ error: 'nfcTagId query param is required' });
  }

  try {
    const gram = await db.getGramByTag(tagId);
    if (!gram) {
      return res.status(404).json({ error: 'Gram not found for this tag' });
    }
    return res.json(gram);
  } catch (err) {
    console.error('Error fetching gram by tag:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------------------------------------------------------
// Get a single Gram by slug (used by share URLs /?slug=blue-skies-1)
// -----------------------------------------------------------------------------
app.get('/api/grams/by-slug/:slug', async (req, res) => {
  const slug = req.params.slug;

  try {
    const gram = await db.getGramBySlug(slug);
    if (!gram) {
      return res.status(404).json({ error: 'Gram not found for this slug' });
    }
    return res.json(gram);
  } catch (err) {
    console.error('Error fetching gram by slug:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------------------------------------------------------
// Upload one or more images from Producer UI to Shopify Files
// -----------------------------------------------------------------------------
// --- Shopify GraphQL helper ---
async function shopifyGraphQL(query, variables = {}) {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;

    const endpoint = `https://${storeDomain}/admin/api/2025-01/graphql.json`;

    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': adminToken
        },
        body: JSON.stringify({ query, variables })
    });

    const json = await resp.json();

    if (json.errors) {
        console.error('Shopify GraphQL errors:', json.errors);
        throw new Error('Shopify GraphQL error');
    }

    return json.data;
}

// --- 1) Create staged upload target ---
async function createStagedUpload(file) {
    // For fileCreate-based flows, Shopify docs use resource: "FILE"
    const query = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;

    const input = [{
        filename: file.originalname,
        mimeType: file.mimetype,
        resource: "FILE",      // <--- ALWAYS FILE
        httpMethod: "POST"
    }];

    const data = await shopifyGraphQL(query, { input });

    const errs = data.stagedUploadsCreate.userErrors || [];
    if (errs.length) {
        console.error('stagedUploadsCreate userErrors:', errs);
        throw new Error('stagedUploadsCreate failed: ' + JSON.stringify(errs));
    }

    return data.stagedUploadsCreate.stagedTargets[0];
}


// --- 2) Upload binary to Shopify's S3 target ---
async function uploadBinaryToShopify(target, file) {
    const form = new FormData();

    // Shopify's required S3 parameters (policy, key, etc.)
    for (const param of target.parameters) {
        form.append(param.name, param.value);
    }

    // Append the actual file as Buffer (form-data supports Buffers)
    form.append("file", file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
    });

    const res = await fetch(target.url, {
        method: 'POST',
        body: form,
        // node-fetch + form-data will set the correct Content-Type boundary
    });

    const text = await res.text();

    if (!res.ok) {
        console.error('Staged upload to Shopify S3 failed:', res.status, text);
        // IMPORTANT: include AWS error text in the thrown message
        throw new Error(`Staged upload failed: ${text}`);
    }

    // (Shopify's S3 usually returns 201/204 with empty body on success)
}



// --- helper: query file by id to get URL once processed ---
async function fetchMediaImageUrlById(fileId) {
    const query = `
    query fileById($id: ID!) {
      node(id: $id) {
        ... on File {
          fileStatus
          preview {
            image { url }
          }
        }
      }
    }
  `;

    const data = await shopifyGraphQL(query, { id: fileId });
    const node = data.node;
    if (!node) {
        return { status: null, url: null };
    }

    return {
        status: node.fileStatus,
        url: node.preview && node.preview.image ? node.preview.image.url : null
    };
}


// --- 3) Create permanent File and try to get its CDN URL ---
async function finalizeShopifyFile(resourceUrl, filename) {
    const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          preview {
            image { url }
          }
        }
        userErrors { field message }
      }
    }
  `;

    const variables = {
        files: [{
            originalSource: resourceUrl,
            filename
        }]
    };

    const data = await shopifyGraphQL(query, variables);

    const errs = data.fileCreate.userErrors || [];
    if (errs.length) {
        console.error('fileCreate userErrors:', errs);
        throw new Error('fileCreate failed');
    }

    const f = data.fileCreate.files[0];

    let id = f.id;
    let status = f.fileStatus;
    // 🔑 URL now read from preview.image.url
    let url = (f.preview && f.preview.image && f.preview.image.url) || null;

    // If still not READY or no URL yet, poll a couple of times
    if (!url || status !== 'READY') {
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 500)); // wait 0.5s
            const info = await fetchMediaImageUrlById(id);
            if (info.url) {
                url = info.url;
                status = info.status || status;
                break;
            }
        }
    }

    return { id, status, url };
}


// =====================================================================
// FINAL ROUTE: /api/producer/upload-images
// =====================================================================
app.post('/api/producer/upload-images', upload.array('files'), async (req, res) => {
    const files = req.files;
    if (!files || !files.length) {
        return res.status(400).json({ error: "No files uploaded" });
    }

    try {
        const results = [];

        for (const file of files) {
            const stagedTarget = await createStagedUpload(file);
            await uploadBinaryToShopify(stagedTarget, file);
            const finalFile = await finalizeShopifyFile(stagedTarget.resourceUrl, file.originalname);

            results.push({
                originalName: file.originalname,
                shopifyId: finalFile.id,
                url: finalFile.url,
                status: finalFile.status
            });
        }

        res.json({ ok: true, files: results });
    } catch (err) {
        console.error("Error in /api/producer/upload-images:", err);
        res.status(500).json({ error: "Failed to upload files", details: err.message });
    }

});

// -----------------------------------------------------------------------------
// Save a new Gram from Producer UI
// -----------------------------------------------------------------------------
app.post('/api/producer/grams', async (req, res) => {
  const gram = req.body;
  console.log('Incoming Gram from Producer UI:', gram);

  if (!gram || !gram.id || !gram.slug || !gram.nfc_tag_id || !gram.title || !gram.image_url) {
    console.error('Missing required Gram fields');
    return res.status(400).json({ error: 'Missing required Gram fields' });
  }

  try {
    const created = await db.createGram({
      id: gram.id,
      slug: gram.slug,
      nfc_tag_id: gram.nfc_tag_id,
      title: gram.title,
      image_url: gram.image_url,
      description: gram.description || '',
      effects: gram.effects || {},
      owner_id: gram.owner_id || null,
      perks: Array.isArray(gram.perks) ? gram.perks : []
    });

    if (gram.owner_id) {
      await db.setOwner(created.id, String(gram.owner_id));
    }

    if (Array.isArray(gram.perks)) {
      for (const p of gram.perks) {
        await db.addPerk(created.id, p);
      }
    }

    console.log('Gram saved OK:', created.id);
    return res.json({ ok: true, gram: created });
  } catch (err) {
    console.error('Error saving Gram:', err);
    return res.status(500).json({ error: 'Failed to save Gram', details: String(err.message || err) });
  }
});

// Get next Gram ID (e.g. G001 → G002) based on existing records in Supabase
app.get('/api/producer/next-id', async (req, res) => {
    try {
        const grams = await db.getAllGrams(); // SupabaseDB method

        let maxNum = 0;
        for (const g of grams) {
            if (!g.id) continue;
            const m = /^G(\d+)$/.exec(g.id);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n > maxNum) maxNum = n;
            }
        }

        const nextNumber = maxNum + 1;
        const nextId = 'G' + String(nextNumber).padStart(3, '0');

        res.json({ id: nextId });
    } catch (err) {
        console.error('Error computing next Gram ID:', err);
        res.status(500).json({ error: 'Failed to compute next ID' });
    }
});


// -----------------------------------------------------------------------------
// Claim a Gram for a given owner (customer)
// -----------------------------------------------------------------------------
app.post('/api/grams/claim', async (req, res) => {
  const { gramId, ownerId } = req.body || {};
  if (!gramId || !ownerId) {
    return res.status(400).json({ error: 'gramId and ownerId are required' });
  }

  try {
    const gram = await db.getGramById(gramId);
    if (!gram) {
      return res.status(404).json({ error: 'Gram not found' });
    }

    // Normalize owner value (treat "null", "", etc. as no owner)
    const rawOwner = gram.owner_id;
    const hasOwner =
      rawOwner !== null &&
      rawOwner !== undefined &&
      rawOwner !== '' &&
      rawOwner !== 'null' &&
      rawOwner !== 'undefined';

    if (hasOwner) {
      // already claimed
      if (String(rawOwner) === String(ownerId)) {
        return res.json({ ok: true, alreadyOwned: true, gram });
      }
      return res.status(409).json({ error: 'Gram already claimed by another owner' });
    }

    // Not claimed yet → claim it
    const updated = await db.setOwner(gramId, ownerId);
    return res.json({ ok: true, claimed: true, gram: updated });
  } catch (err) {
    console.error('Error claiming Gram:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log('Server running on', PORT);
});
