// db/memory.js
// Simple file-backed in-memory DB for grams

const fs = require('fs');
const path = require('path');

const GRAMS_PATH = path.join(__dirname, '../data/grams.json');

class MemoryDB {
    constructor() {
        this.grams = [];
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(GRAMS_PATH)) {
                const raw = fs.readFileSync(GRAMS_PATH, 'utf8');
                this.grams = JSON.parse(raw);
            } else {
                this.grams = [];
            }
        } catch (err) {
            console.error('Error loading grams.json:', err);
            this.grams = [];
        }
    }

    _save() {
        try {
            fs.writeFileSync(GRAMS_PATH, JSON.stringify(this.grams, null, 2), 'utf8');
        } catch (err) {
            console.error('Error saving grams.json:', err);
        }
    }

    // ---- Core ops ----

    createGram(data) {
        if (!data || !data.id) {
            throw new Error('createGram requires an id');
        }

        // Avoid duplicates
        const existing = this.grams.find(g => g.id === data.id);
        if (existing) {
            throw new Error(`Gram with id ${data.id} already exists`);
        }

        const gram = {
            id: data.id,
            slug: data.slug || null,
            nfc_tag_id: data.nfc_tag_id || null,
            title: data.title || '',
            image_url: data.image_url || '',
            description: data.description || '',
            effects: data.effects || {},
            owner_id: data.owner_id || null,
            perks: Array.isArray(data.perks) ? data.perks : []
        };

        this.grams.push(gram);
        this._save();
        return gram;
    }

    setOwner(gramId, ownerId) {
        const gram = this.grams.find(g => g.id === gramId);
        if (!gram) return;
        gram.owner_id = String(ownerId);
        this._save();
    }

    addPerk(gramId, perk) {
        const gram = this.grams.find(g => g.id === gramId);
        if (!gram) return;

        if (!Array.isArray(gram.perks)) {
            gram.perks = [];
        }

        gram.perks.push({
            id: perk.id,
            business_id: perk.business_id,
            business_name: perk.business_name,
            type: perk.type,
            metadata: perk.metadata || {},
            cooldown_seconds: perk.cooldown_seconds || 0
        });

        this._save();
    }

    // ---- Queries ----

    getGramsByOwner(ownerId) {
        const target = String(ownerId);
        return this.grams.filter(g => g.owner_id === target);
    }

    getGramByTag(tagId) {
        const target = String(tagId);
        return this.grams.find(g => g.nfc_tag_id === target) || null;
    }

    getGramBySlug(slug) {
        const target = String(slug);
        return this.grams.find(g => g.slug === target) || null;
    }

    getGramById(id) {
        const target = String(id);
        return this.grams.find(g => g.id === target) || null;
    }

    getAllGrams() {
        return this.grams.slice();
    }
}

module.exports = MemoryDB;
