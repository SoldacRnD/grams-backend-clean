const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const MemoryDB = require('./db/memory');
const newId = require('./utils/id');

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const app = express();
app.use(cors());               // enable CORS for all origins (fine for now)
app.use(bodyParser.json());

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
const path = require('path');

app.use('/producer', express.static(path.join(__dirname, 'producer-ui')));

// Save a new Gram from Producer UI
app.post('/api/producer/grams', (req, res) => {
    const gram = req.body;
    if (!gram || !gram.id || !gram.slug || !gram.nfc_tag_id || !gram.title || !gram.image_url) {
        return res.status(400).json({ error: 'Missing required Gram fields' });
    }

    try {
        // Create Gram
        const created = db.createGram({
            id: gram.id,
            slug: gram.slug,
            nfc_tag_id: gram.nfc_tag_id,
            title: gram.title,
            image_url: gram.image_url,
            description: gram.description || '',
            effects: gram.effects || {},
            owner_id: gram.owner_id || null,
            perks: []   // we'll add perks below
        });

        // Set owner if provided
        if (gram.owner_id) {
            db.setOwner(created.id, String(gram.owner_id));
        }

        // Add perks if any
        if (Array.isArray(gram.perks)) {
            gram.perks.forEach(p => {
                db.addPerk(created.id, p);
            });
        }

        return res.json({ ok: true, gram: created });
    } catch (err) {
        console.error('Error saving Gram:', err);
        return res.status(500).json({ error: 'Failed to save Gram' });
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

