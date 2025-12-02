const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');                    // NEW
const fetch = require('node-fetch');                 // NEW
const MemoryDB = require('./db/memory');
const newId = require('./utils/id');


const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const app = express();
app.use(cors());               // enable CORS for all origins (fine for now)
app.use(bodyParser.json());

const upload = multer({ storage: multer.memoryStorage() });


const db = new MemoryDB();
// Serve producer web UI
app.use('/producer', express.static(path.join(__dirname, 'producer-ui')));



// List grams by owner (used by "My Grams" page)
app.get('/api/grams', (req, res) => {
    const ownerId = req.query.ownerId;
    if (!ownerId) {
        return res.status(400).json({ error: 'ownerId required' });
    }
    return res.json(db.getGramsByOwner(ownerId));
});

// Get a single Gram by NFC tag (used by NFC / ?tag=ABC123)
app.get('/api/grams/by-tag', (req, res) => {
    const tagId = req.query.nfcTagId;
    if (!tagId) {
        return res.status(400).json({ error: 'nfcTagId query param is required' });
    }

    const gram = db.getGramByTag(tagId);
    if (!gram) {
        return res.status(404).json({ error: 'Gram not found for this tag' });
    }

    return res.json(gram);
});

// Get a single Gram by slug (used by share URLs /?slug=blue-skies-1)
app.get('/api/grams/by-slug/:slug', (req, res) => {
    const slug = req.params.slug;
    const gram = db.getGramBySlug(slug);
    if (!gram) {
        return res.status(404).json({ error: 'Gram not found for this slug' });
    }
    return res.json(gram);
});
// Static Producer UI
app.use('/producer', express.static(path.join(__dirname, 'producer-ui')));

// Save a new Gram from Producer UI
// Upload one or more images from Producer UI to Shopify Files
// Upload one or more images from Producer UI to Shopify Files
app.post('/api/producer/upload-images', upload.array('files'), async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!storeDomain || !adminToken) {
        return res.status(500).json({ error: 'Shopify credentials not configured' });
    }

    const results = [];
    const apiVersion = '2025-01'; // current Admin API version

    try {
        for (const file of files) {
            const attachmentBase64 = file.buffer.toString('base64');

            const payload = {
                file: {
                    attachment: attachmentBase64,
                    filename: file.originalname,
                    mime_type: file.mimetype
                }
            };

            const url = `https://${storeDomain}/admin/api/${apiVersion}/files.json`;

            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': adminToken
                },
                body: JSON.stringify(payload)
            });

            const text = await resp.text();

            if (!resp.ok) {
                console.error('Shopify upload error:', resp.status, text);
                return res.status(500).json({
                    error: `Shopify upload failed (${resp.status})`,
                    details: text
                });
            }

            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error('Failed to parse Shopify response as JSON:', text);
                return res.status(500).json({ error: 'Invalid JSON from Shopify Files API' });
            }

            const fileObj = data.file || (Array.isArray(data.files) ? data.files[0] : null);

            if (!fileObj || !fileObj.url) {
                console.error('Unexpected Shopify Files response shape:', data);
                return res.status(500).json({ error: 'Unexpected Shopify Files response' });
            }

            results.push({
                originalName: file.originalname,
                url: fileObj.url
            });
        }

        return res.json({ files: results });
    } catch (err) {
        console.error('Error in upload-images:', err);
        return res.status(500).json({ error: 'Failed to upload images to Shopify (exception)' });
    }
});

// Save a new Gram from Producer UI
app.post('/api/producer/grams', (req, res) => {
    const gram = req.body;
    console.log('Incoming Gram from Producer UI:', gram);

    if (!gram || !gram.id || !gram.slug || !gram.nfc_tag_id || !gram.title || !gram.image_url) {
        console.error('Missing required Gram fields');
        return res.status(400).json({ error: 'Missing required Gram fields' });
    }

    try {
        const created = db.createGram({
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
            db.setOwner(created.id, String(gram.owner_id));
        }

        if (Array.isArray(gram.perks)) {
            gram.perks.forEach(p => db.addPerk(created.id, p));
        }

        console.log('Gram saved OK:', created.id);
        return res.json({ ok: true, gram: created });
    } catch (err) {
        console.error('Error saving Gram:', err);
        return res.status(500).json({ error: 'Failed to save Gram', details: String(err.message || err) });
    }
});



// OPTIONAL: image upload stub (needs Shopify credentials + node-fetch/axios)
// app.post('/api/producer/upload-image', async (req, res) => {
//   // TODO: parse incoming file, call Shopify Admin API /files.json
//   // This is left as a stub because it requires your private API keys.
//   return res.status(501).json({ error: 'Not implemented. Upload directly to Shopify Files for now.' });
// });

app.listen(PORT, () => {
    console.log('Server running on', PORT);
});

