// scripts/export-backup.js
const fs = require('fs');
const path = require('path');
const MemoryDB = require('../db/memory');

const db = new MemoryDB();

// TODO: for now this re-runs the same seed logic as server.js.
// Later we’ll refactor to share the seed in one place.
(function seed(){
  const newId = require('../utils/id');
  const g1 = db.createGram({
    id: 'TEST1',
    slug: 'blue-skies-1',
    nfc_tag_id: 'ABC123',
    title: 'Blue Skies #1',
    image_url: 'https://placehold.co/480x320?text=Blue+Skies',
    description: 'First Gram in the Blue Skies series.',
    effects: { frame: 'gold', glow: true }
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

const allGrams = db.getGramsByOwner('111'); // or a db.getAllGrams() if you add one

const outPath = path.join(__dirname, '..', 'backup-data', 'grams.json');
fs.writeFileSync(outPath, JSON.stringify(allGrams, null, 2), 'utf8');
console.log('Exported grams to', outPath);
