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

// Seed demo grams and perks
; (function seed() {
    // in server.js seed block

    const g1 = db.createGram({
        id: 'TEST1',
        slug: 'blue-sitting-cat-1',
        nfc_tag_id: 'TAG-CAT-001',
        title: 'Blue Sitting Cat #1',
        image_url: 'https://cdn.shopify.com/s/files/1/0919/6309/7469/files/GRAM_For-Print-on-CP1300-working-on-BOOMjpg_03_3_89a09c5e-4107-46f7-a372-e86871c6932a.jpg?v=1764603192',
        description: 'Watercolour cat from the NFC Gram collection.',
        effects: { frame: 'black' }
    });

    db.setOwner(g1.id, '111');
    db.addPerk(g1.id, {
        id: 'hGf-aM9D',
        business_id: 'CAFE57',
        business_name: 'Café Blue',
        type: 'discount',
        metadata: { discount_percent: 10 },
        cooldown_seconds: 86400
    });

})();

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

app.listen(PORT, () => {
    console.log('Server running on', PORT);
});

