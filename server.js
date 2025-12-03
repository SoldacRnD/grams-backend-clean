const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');
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
const FormData = require('form-data');

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

    if (json.errors || json.data?.stagedUploadsCreate?.userErrors?.length) {
        console.error("Shopify GraphQL error:", json.errors || json.data.stagedUploadsCreate.userErrors);
        throw new Error("Shopify GraphQL API Error");
    }

    return json.data;
}

// Create staged upload target at Shopify
async function createStagedUpload(file) {
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
        resource: "FILE",
        httpMethod: "POST"
    }];

    const data = await shopifyGraphQL(query, { input });
    return data.stagedUploadsCreate.stagedTargets[0];
}

// Upload the binary to Shopify’s staged target
async function uploadBinaryToShopify(target, file) {
    const form = new FormData();

    // Required AWS S3 fields
    for (const param of target.parameters) {
        form.append(param.name, param.value);
    }

    // Actual file
    form.append("file", file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
    });

    const res = await fetch(target.url, {
        method: "POST",
        body: form
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("Staged upload to Shopify S3 failed:", res.status, text);
        throw new Error("Staged S3 upload failed");
    }
}

// Final step: convert staged upload to permanent Shopify File asset
async function finalizeShopifyFile(resourceUrl, filename) {
    const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          preview { image { url } }
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
    const file = data.fileCreate.files[0];

    return {
        id: file.id,
        status: file.fileStatus,
        url: file.preview?.image?.url || null
    };
}


// =====================================================================
// 🔥 FINAL ROUTE: /api/producer/upload-images
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
        console.error("Error in /upload-images:", err);
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
