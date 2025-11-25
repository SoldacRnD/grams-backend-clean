// db/memory.js

class MemoryDB {
    constructor() {
        // store grams in a simple map by id
        this.grams = new Map();
    }

    /**
     * Create a gram record.
     * data can include:
     *  id, slug, nfc_tag_id, title, image_url, description, effects, etc.
     */
    createGram(data) {
        if (!data || !data.id) {
            throw new Error('createGram requires an id');
        }

        const gram = {
            id: data.id,
            slug: data.slug || null,
            nfc_tag_id: data.nfc_tag_id || null,
            title: data.title || '',
            image_url: data.image_url || '',
            description: data.description || '',
            effects: data.effects || {},
            owner_id: null,          // set with setOwner
            perks: []                // filled with addPerk
        };

        this.grams.set(gram.id, gram);
        return gram;
    }

    /**
     * Set the owner of a gram (Shopify customer ID)
     */
    setOwner(gramId, ownerId) {
        const gram = this.grams.get(gramId);
        if (!gram) return;
        gram.owner_id = String(ownerId);
    }

    /**
     * Add a perk to a gram
     */
    addPerk(gramId, perk) {
        const gram = this.grams.get(gramId);
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
    }

    /**
     * Get all grams owned by a specific owner (customer)
     */
    getGramsByOwner(ownerId) {
        const target = String(ownerId);
        return Array.from(this.grams.values()).filter(g => g.owner_id === target);
    }

    /**
     * Get a gram by its NFC tag id
     */
    getGramByTag(tagId) {
        const target = String(tagId);
        return Array.from(this.grams.values()).find(g => g.nfc_tag_id === target) || null;
    }

    /**
     * Get a gram by its slug
     */
    getGramBySlug(slug) {
        const target = String(slug);
        return Array.from(this.grams.values()).find(g => g.slug === target) || null;
    }

    /**
     * Get a gram by its internal id
     */
    getGramById(id) {
        const target = String(id);
        return this.grams.get(target) || null;
    }
}

module.exports = MemoryDB;
