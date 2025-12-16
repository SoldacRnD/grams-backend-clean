// db/supabase.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.warn(
        'Supabase env vars missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY.'
    );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

class SupabaseDB {
    // ----------------------------
    // CREATE / UPDATE
    // ----------------------------

    // Create a new gram (with perks support)
    async createGram(data) {
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
            owner_id: data.owner_id || null,
            perks: Array.isArray(data.perks) ? data.perks : []
        };

        const { data: inserted, error } = await supabase
            .from('grams')
            .insert(gram)
            .select('*')
            .single();

        if (error) {
            console.error('Supabase createGram error:', error);
            throw error;
        }

        return inserted;
    }

    // Update an existing gram (can include perks)
    async updateGram(id, partial) {
        const { data, error } = await supabase
            .from('grams')
            .update(partial)
            .eq('id', id)
            .select('*')
            .single();

        if (error) {
            console.error('Supabase updateGram error:', error);
            throw error;
        }

        return data;
    }

    async setOwner(gramId, ownerId) {
        const { data, error } = await supabase
            .from('grams')
            .update({ owner_id: String(ownerId) })
            .eq('id', gramId)
            .select('*')
            .single();

        if (error) {
            console.error('Supabase setOwner error:', error);
            throw error;
        }

        return data;
    }

    // ----------------------------
    // PERKS NORMALIZATION LAYER (Checkpoint 11.0 Part A)
    // ----------------------------

    // Normalize incoming perk object -> row for perks table
    normalizePerkRow(gramId, p) {
        return {
            gram_id: String(gramId),
            perk_id: String(p.id || ""), // expects existing perk.id from UI
            business_id: String(p.business_id || ""),
            business_name: p.business_name || null,
            type: String(p.type || ""),
            metadata: p.metadata || {},
            cooldown_seconds: Number(p.cooldown_seconds || 0),
            enabled: (p.enabled === undefined ? true : !!p.enabled),
            updated_at: new Date().toISOString(),
        };
    }

    /**
     * Replace all perks rows for a gram with the provided array.
     */
    async replacePerksForGram(gramId, perksArray) {
        const perks = Array.isArray(perksArray) ? perksArray : [];

        // 1) delete existing rows
        const { error: delErr } = await supabase
            .from("perks")
            .delete()
            .eq("gram_id", String(gramId));

        if (delErr) {
            console.error("replacePerksForGram delete error:", delErr);
            throw delErr;
        }

        // 2) insert new
        if (!perks.length) return [];

        const rows = perks
            .filter((p) => p && p.id && p.business_id && p.type) // minimal validity
            .map((p) => this.normalizePerkRow(gramId, p));

        if (!rows.length) return [];

        const { data: ins, error: insErr } = await supabase
            .from("perks")
            .insert(rows)
            .select("*");

        if (insErr) {
            console.error("replacePerksForGram insert error:", insErr);
            throw insErr;
        }

        return ins || [];
    }

    /**
     * Reads enabled perks from perks table, compiles them back into grams.perks snapshot.
     * Returns updated gram row.
     */
    async rebuildGramPerksSnapshot(gramId) {
        const { data: perkRows, error: pErr } = await supabase
            .from("perks")
            .select("perk_id,business_id,business_name,type,metadata,cooldown_seconds,enabled,created_at")
            .eq("gram_id", String(gramId))
            .eq("enabled", true)
            .order("created_at", { ascending: true });

        if (pErr) {
            console.error("rebuildGramPerksSnapshot perks select error:", pErr);
            throw pErr;
        }

        const compiled = (perkRows || []).map((r) => ({
            id: r.perk_id,
            business_id: r.business_id,
            business_name: r.business_name,
            type: r.type,
            metadata: r.metadata || {},
            cooldown_seconds: r.cooldown_seconds || 0,
        }));

        const { data: updated, error: uErr } = await supabase
            .from("grams")
            .update({ perks: compiled })
            .eq("id", String(gramId))
            .select("*")
            .single();

        if (uErr) {
            console.error("rebuildGramPerksSnapshot grams update error:", uErr);
            throw uErr;
        }

        return updated;
    }


    // Optional legacy helper: append a single perk to existing perks
    async addPerk(gramId, perk) {
        // Read existing perks
        const { data: gram, error: fetchError } = await supabase
            .from('grams')
            .select('perks')
            .eq('id', gramId)
            .single();

        if (fetchError) {
            console.error('Supabase addPerk fetch error:', fetchError);
            throw fetchError;
        }

        const perks = Array.isArray(gram.perks) ? gram.perks.slice() : [];

        perks.push({
            id: perk.id,
            business_id: perk.business_id,
            business_name: perk.business_name,
            type: perk.type,
            metadata: perk.metadata || {},
            cooldown_seconds: perk.cooldown_seconds || 0
        });

        const { data: updated, error: updateError } = await supabase
            .from('grams')
            .update({ perks })
            .eq('id', gramId)
            .select('*')
            .single();

        if (updateError) {
            console.error('Supabase addPerk update error:', updateError);
            throw updateError;
        }

        return updated;
    }

    // ----------------------------
    // QUERIES
    // ----------------------------

    async getGramsByOwner(ownerId) {
        const { data, error } = await supabase
            .from('grams')
            .select('*')
            .eq('owner_id', String(ownerId));

        if (error) {
            console.error('Supabase getGramsByOwner error:', error);
            throw error;
        }

        return data || [];
    }

    async getGramByTag(tagId) {
        const { data, error } = await supabase
            .from('grams')
            .select('*')
            .eq('nfc_tag_id', String(tagId))
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase getGramByTag error:', error);
            throw error;
        }

        return data || null;
    }

    async getGramBySlug(slug) {
        const { data, error } = await supabase
            .from('grams')
            .select('*')
            .eq('slug', String(slug))
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase getGramBySlug error:', error);
            throw error;
        }

        return data || null;
    }

    async getGramById(id) {
        const { data, error } = await supabase
            .from('grams')
            .select('*')
            .eq('id', String(id))
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase getGramById error:', error);
            throw error;
        }

        return data || null;
    }

    async getGramByImageUrl(imageUrl) {
        // Normalize Shopify URLs by removing ?v=... or any query params
        function normalize(url) {
            if (!url) return url;
            try {
                const u = new URL(url);
                u.search = '';
                return u.toString();
            } catch (e) {
                const idx = url.indexOf('?');
                return idx === -1 ? url : url.slice(0, idx);
            }
        }

        const base = normalize(imageUrl);

        // --- 1) Try exact match on normalized URL ---
        let { data, error } = await supabase
            .from('grams')
            .select('*')
            .eq('image_url', base)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase getGramByImageUrl error (exact match):', error);
            throw error;
        }

        if (data) return data;

        // --- 2) Fallback: old rows stored with ?v=... or other queries ---
        ({ data, error } = await supabase
            .from('grams')
            .select('*')
            .ilike('image_url', `${base}%`)
            .maybeSingle());

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase getGramByImageUrl error (ilike fallback):', error);
            throw error;
        }

        return data || null;
    }
    async deleteGram(id) {
        const { error } = await supabase
            .from('grams')
            .delete()
            .eq('id', String(id));

        if (error) {
            console.error('Supabase deleteGram error:', error);
            throw error;
        }
    }

    // Normalize incoming perk object -> row for perks table
    normalizePerkRow(gramId, p) {
        return {
            gram_id: String(gramId),
            perk_id: String(p.id || ""),                  // expects existing perk.id from UI
            business_id: String(p.business_id || ""),
            business_name: p.business_name || null,
            type: String(p.type || ""),
            metadata: p.metadata || {},
            cooldown_seconds: Number(p.cooldown_seconds || 0),
            enabled: (p.enabled === undefined ? true : !!p.enabled),
            updated_at: new Date().toISOString(),
        };
    }

    /**
     * Replace all perks rows for a gram with the provided array.
     * (Authoritative sync from grams.perks snapshot for now.)
     */
    async replacePerksForGram(gramId, perksArray) {
        const perks = Array.isArray(perksArray) ? perksArray : [];

        // 1) delete existing
        const { error: delErr } = await supabase
            .from('perks')
            .delete()
            .eq('gram_id', String(gramId));

        if (delErr) {
            console.error('replacePerksForGram delete error:', delErr);
            throw delErr;
        }

        // 2) insert new (skip empty)
        if (!perks.length) return [];

        const rows = perks
            .filter(p => p && p.id && p.business_id && p.type) // minimal validity
            .map(p => this.normalizePerkRow(gramId, p));

        if (!rows.length) return [];

        const { data: ins, error: insErr } = await supabase
            .from('perks')
            .insert(rows)
            .select('*');

        if (insErr) {
            console.error('replacePerksForGram insert error:', insErr);
            throw insErr;
        }

        return ins || [];
    }

    /**
     * Reads enabled perks from perks table, compiles them back into grams.perks snapshot.
     * Returns updated gram row.
     */
    async rebuildGramPerksSnapshot(gramId) {
        const { data: perkRows, error: pErr } = await supabase
            .from('perks')
            .select('perk_id,business_id,business_name,type,metadata,cooldown_seconds,enabled,created_at')
            .eq('gram_id', String(gramId))
            .eq('enabled', true)
            .order('created_at', { ascending: true });

        if (pErr) {
            console.error('rebuildGramPerksSnapshot perks select error:', pErr);
            throw pErr;
        }

        // Compile to the exact shape your frontend + redeem endpoint expects today
        const compiled = (perkRows || []).map(r => ({
            id: r.perk_id,
            business_id: r.business_id,
            business_name: r.business_name,
            type: r.type,
            metadata: r.metadata || {},
            cooldown_seconds: r.cooldown_seconds || 0,
            // (we omit enabled in snapshot; only enabled perks are compiled)
        }));

        const { data: updated, error: uErr } = await supabase
            .from('grams')
            .update({ perks: compiled })
            .eq('id', String(gramId))
            .select('*')
            .single();

        if (uErr) {
            console.error('rebuildGramPerksSnapshot grams update error:', uErr);
            throw uErr;
        }

        return updated;
    }


    async getAllGrams() {
        const { data, error } = await supabase
            .from('grams')
            .select('*');

        if (error) {
            console.error('Supabase getAllGrams error:', error);
            throw error;
        }

        return data || [];
    }
}

module.exports = { SupabaseDB, supabase };

