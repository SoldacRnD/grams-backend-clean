const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const MemoryDB = require('./db/memory');
const newId = require('./utils/id');

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

const app = express();
app.use(cors());               // <- enable CORS for all origins (fine for now)
app.use(bodyParser.json());

const db = new MemoryDB();


// Seed demo grams and perks
;(function seed(){
  const g1 = db.createGram({ id: 'TEST1', title: 'Blue Skies #1', image_url: 'https://via.placeholder.com/480x320?text=Blue+Skies' })
  db.setOwner(g1.id, '111')
  db.addPerk(g1.id, { id: newId(8), business_id: 'CAFE57', business_name: 'Café Blue', type: 'discount', metadata: { discount_percent: 10 }, cooldown_seconds: 86400 })
})()

app.get('/api/grams', (req,res)=>{
  const ownerId = req.query.ownerId
  if(!ownerId) return res.status(400).json({ error: 'ownerId required' })
  return res.json(db.getGramsByOwner(ownerId))
})

app.listen(PORT, ()=>console.log('Server running on', PORT))
