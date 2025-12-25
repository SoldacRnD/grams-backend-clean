const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { SupabaseDB, supabase } = require('./db/supabase'); // using Supabase now
const newId = require('./utils/id');
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const app = express();
app.get("/api/health", (req, res) => {
    res.status(200).json({ ok: true });
});

// Behind Render/Proxy: needed so req.secure reflects X-Forwarded-Proto
app.set('trust proxy', 1);

const {
    listProducts,
    createProductForGram,
    updateProductForGram,
    syncGramMetafieldsToShopify,
    createBasicDiscountCode,
    createFreeProduct100DiscountCode,
} = require("./db/shopify");
const crypto = require("crypto");
const VENDOR_SECRET_SALT = process.env.VENDOR_SECRET_SALT || "CHANGE_ME";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const SOLDAC_BUSINESS_ID = process.env.SOLDAC_BUSINESS_ID || "SOLDAC";
const QRCode = require("qrcode");

function hashVendorSecret(secret) {
    return crypto
        .createHmac("sha256", VENDOR_SECRET_SALT)
        .update(String(secret || ""))
        .digest("hex");
}

function safeEqual(a, b) {
    const aa = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
}

async function requireVendor(req, res, next) {
    try {
        const business_id =
            (req.headers["x-business-id"] || req.query.business_id || req.body?.business_id || "")
                .toString()
                .trim();

        const vendor_secret =
            (req.headers["x-vendor-secret"] || req.body?.vendor_secret || "")
                .toString()
                .trim();

        if (!business_id) return res.status(401).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        if (!vendor_secret) return res.status(401).json({ ok: false, error: "MISSING_VENDOR_SECRET" });

        // 1) Load vendor FIRST
        const { data: vendor, error } = await supabase
            .from("vendors")
            .select("*")
            .eq("business_id", business_id)
            .maybeSingle();

        if (error) throw error;
        if (!vendor) return res.status(401).json({ ok: false, error: "VENDOR_NOT_FOUND" });

        // 2) Then check onboarded
        if (!vendor.secret_hash) {
            return res.status(403).json({ ok: false, error: "VENDOR_NOT_ONBOARDED" });
        }

        // 3) Verify secret
        const expected = vendor.secret_hash;
        const got = hashVendorSecret(vendor_secret);
        if (!safeEqual(expected, got)) {
            return res.status(401).json({ ok: false, error: "INVALID_VENDOR_SECRET" });
        }

        req.vendor = vendor;
        next();
    } catch (err) {
        console.error("Vendor auth error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_AUTH_ERROR" });
    }
}

function requireAdmin(req, res, next) {
    const key = (req.headers["x-admin-key"] || "").toString().trim();

    if (!ADMIN_KEY) {
        return res.status(500).json({ ok: false, error: "ADMIN_KEY_NOT_SET" });
    }
    if (!key || key !== ADMIN_KEY) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    next();
}

function makeVendorSecret() {
    // 24 bytes -> 48 hex chars
    return crypto.randomBytes(24).toString("hex").toUpperCase();
}
function makeOnboardingToken() {
    return crypto.randomBytes(24).toString("hex"); // shareable token
}

function hashOnboardingToken(token) {
    const salt = process.env.VENDOR_SECRET_SALT || "CHANGE_ME"; // reuse your salt
    return crypto.createHmac("sha256", salt).update(String(token || "")).digest("hex");
}

// --- Vendor session cookie (for smart NFC redirect) ---
const VENDOR_SESSION_COOKIE = "vendor_session";
const VENDOR_SESSION_SECRET =
    process.env.VENDOR_SESSION_SECRET || process.env.VENDOR_SECRET_SALT || "CHANGE_ME_VENDOR_SESSION_SECRET";

function readCookie(req, name) {
    const raw = req.headers.cookie || "";
    const parts = raw.split(";").map(s => s.trim());
    for (const part of parts) {
        if (part.startsWith(name + "=")) {
            return decodeURIComponent(part.slice(name.length + 1));
        }
    }
    return null;
}

function signVendorSession(businessId) {
    const bid = String(businessId || "").trim();
    const sig = crypto
        .createHmac("sha256", VENDOR_SESSION_SECRET)
        .update(bid)
        .digest("hex");
    return `${bid}.${sig}`;
}

function verifyVendorSession(value) {
    if (!value) return null;
    const [bid, sig] = String(value).split(".");
    if (!bid || !sig) return null;
    const expected = crypto
        .createHmac("sha256", VENDOR_SESSION_SECRET)
        .update(bid)
        .digest("hex");
    if (!safeEqual(expected, sig)) return null;
    return bid;
}


// Middleware
app.use(cors());
function rawBodySaver(req, res, buf) {
    req.rawBody = buf;
}

app.use(express.json({ verify: rawBodySaver })); // default type: application/json
app.use(express.json({ limit: "2mb", verify: rawBodySaver }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Import from /notion because you have no /routes folder
const { router: checkpointsRouter, createCheckpointPage } = require('./notion/checkpoints');
app.use('/api/checkpoints', checkpointsRouter);


const upload = multer({ storage: multer.memoryStorage() });
const db = new SupabaseDB();

// Serve producer web UI
app.use('/producer', express.static(path.join(__dirname, 'producer-ui')));

// Serve vendor web UI
app.use('/vendor', express.static(path.join(__dirname, 'vendor-ui')));

app.get("/api/vendor/onboard", async (req, res) => {
    try {
        const business_id = String(req.query.business_id || "").trim();
        const token = String(req.query.token || "").trim();

        if (!business_id) return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        if (!token) return res.status(400).json({ ok: false, error: "MISSING_TOKEN" });

        const token_hash = hashOnboardingToken(token);

        const { data: vendor, error } = await supabase
            .from("vendors")
            .select("business_id,business_name,address,maps_url,lat,lng,onboarding_token_hash,secret_hash")
            .eq("business_id", business_id)
            .maybeSingle();

        if (error) throw error;
        if (!vendor) return res.status(404).json({ ok: false, error: "VENDOR_NOT_FOUND" });

        if (!vendor.onboarding_token_hash) {
            if (vendor.secret_hash) {
                return res.status(409).json({ ok: false, error: "ALREADY_ONBOARDED" });
            }
            return res.status(410).json({ ok: false, error: "ONBOARDING_LINK_EXPIRED" });
        }
        if (!safeEqual(vendor.onboarding_token_hash, token_hash)) {
            return res.status(401).json({ ok: false, error: "INVALID_ONBOARDING_TOKEN" });
        }

        return res.json({
            ok: true,
            vendor: {
                business_id: vendor.business_id,
                business_name: vendor.business_name,
                address: vendor.address,
                maps_url: vendor.maps_url,
                lat: vendor.lat,
                lng: vendor.lng
            }
        });
    } catch (err) {
        console.error("Onboard verify error:", err);
        return res.status(500).json({ ok: false, error: "ONBOARD_VERIFY_ERROR" });
    }
});

app.post("/api/vendor/onboard/complete", async (req, res) => {
    try {
        const business_id = String(req.body?.business_id || "").trim();
        const token = String(req.body?.token || "").trim();

        if (!business_id) return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        if (!token) return res.status(400).json({ ok: false, error: "MISSING_TOKEN" });

        const token_hash = hashOnboardingToken(token);

        // 1) Fetch vendor first (read-only)
        const { data: vendor, error: fetchErr } = await supabase
            .from("vendors")
            .select("business_id,business_name,onboarding_token_hash,secret_hash")
            .eq("business_id", business_id)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!vendor) return res.status(404).json({ ok: false, error: "VENDOR_NOT_FOUND" });

        // 2) If already onboarded, do NOT mint a new secret
        if (vendor.secret_hash) {
            return res.status(409).json({ ok: false, error: "ALREADY_ONBOARDED" });
        }

        // 3) Token must exist + match
        if (!vendor.onboarding_token_hash) {
            return res.status(410).json({ ok: false, error: "ONBOARDING_LINK_EXPIRED" });
        }
        if (!safeEqual(vendor.onboarding_token_hash, token_hash)) {
            return res.status(401).json({ ok: false, error: "INVALID_ONBOARDING_TOKEN" });
        }

        // 4) Mint vendor secret and store hash only
        const vendor_secret = makeVendorSecret();
        const secret_hash = hashVendorSecret(vendor_secret);

        // 5) Persist once, and CHECK error
        const { error: upErr } = await supabase
            .from("vendors")
            .update({
                secret_hash,
                onboarding_token_hash: null, // single-use
                onboarded_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("business_id", business_id);

        if (upErr) throw upErr;

        return res.json({
            ok: true,
            vendor: { business_id: vendor.business_id, business_name: vendor.business_name },
            vendor_secret, // returned ONCE to onboarding page
            note: "Vendor Secret generated and returned once. Store it securely on this device.",
        });
    } catch (err) {
        console.error("Onboard complete error:", err);
        return res.status(500).json({ ok: false, error: "ONBOARD_COMPLETE_ERROR" });
    }
});
// Smart NFC entrypoint: decide vendor vs customer
app.get("/t/:tag", async (req, res) => {
    try {
        const tag = String(req.params.tag || "").trim();
        if (!tag) return res.status(400).send("Missing tag");

        // ✅ READ COOKIE + VERIFY
        const rawCookie = req.headers.cookie || "";
        const sess = readCookie(req, VENDOR_SESSION_COOKIE);
        const businessId = verifyVendorSession(sess);

        console.log("[tap]", {
            tag,
            hasCookie: !!rawCookie,
            hasVendorCookie: !!sess,
            businessId,
            ua: (req.headers["user-agent"] || "").toString().slice(0, 80),
        });

        // 1) Vendor flow
        if (businessId) {
            const { data: vendor, error } = await supabase
                .from("vendors")
                .select("business_id,secret_hash")
                .eq("business_id", businessId)
                .maybeSingle();

            if (!error && vendor && vendor.secret_hash) {
                return res.redirect(
                    `/vendor/validate.html?business_id=${encodeURIComponent(businessId)}&tag=${encodeURIComponent(tag)}`
                );
            }
        }

        // 2) Customer flow
        return res.redirect(
            `https://www.soldacstudio.com/pages/gram?tag=${encodeURIComponent(tag)}`
        );
    } catch (err) {
        console.error("Smart tap redirect error:", err);
        return res.redirect(
            `https://www.soldacstudio.com/pages/gram?tag=${encodeURIComponent(req.params.tag || "")}`
        );
    }
});



// -----------------------------------------------------------------------------
// List grams by owner (used by "My Grams" page) + response with redemption status
// -----------------------------------------------------------------------------
app.get('/api/grams', async (req, res) => {
    const ownerId = req.query.ownerId;
    if (!ownerId) {
        return res.status(400).json({ error: 'ownerId required' });
    }

    try {
        const grams = await db.getGramsByOwner(ownerId);

        // Attach redemption status for shop perks (issued vs consumed)
        const gramIds = (grams || []).map(g => g.id).filter(Boolean);
        if (!gramIds.length) return res.json(grams);

        const redeemerKey = `customer:${String(ownerId)}`;

        const { data: reds, error: redsErr } = await supabase
            .from("redemptions")
            .select("gram_id, perk_id, status, redeemed_at, consumed_at, order_id, shopify_discount_code")
            .eq("redeemer_fingerprint", redeemerKey)
            .in("gram_id", gramIds)
            .order("redeemed_at", { ascending: false });

        if (redsErr) {
            console.error("Error fetching redemptions for My Grams:", redsErr);
            return res.json(grams); // don't break My Grams if audit query fails
        }

        // latest redemption per (gram_id, perk_id)
        const latest = new Map();
        for (const r of (reds || [])) {
            const key = `${r.gram_id}:${r.perk_id}`;
            if (!latest.has(key)) latest.set(key, r);
        }

        const enriched = (grams || []).map(g => {
            const perks = Array.isArray(g.perks) ? g.perks : [];
            const perks2 = perks.map(p => {
                const r = latest.get(`${g.id}:${p.id}`);
                if (!r) return p;

                return {
                    ...p,
                    redemption_status: r.status || null,   // "issued" | "consumed"
                    redemption_issued_at: r.redeemed_at || null,
                    redemption_consumed_at: r.consumed_at || null,
                    redemption_order_id: r.order_id || null,
                    redemption_code: r.shopify_discount_code || null,
                };
            });

            return { ...g, perks: perks2 };
        });
        // Collect vendor ids from perks
        const vendorIds = new Set();
        for (const g of enriched || []) {
            const perks = Array.isArray(g.perks) ? g.perks : [];
            for (const p of perks) {
                if (p?.business_id) vendorIds.add(String(p.business_id));
            }
        }

        if (vendorIds.size) {
            const { data: vendors, error: vErr } = await supabase
                .from("vendors")
                .select("business_id,business_name,address,maps_url")
                .in("business_id", Array.from(vendorIds));

            if (!vErr && vendors) {
                const vMap = new Map(vendors.map(v => [String(v.business_id), v]));

                const enriched2 = enriched.map(g => {
                    const perks = Array.isArray(g.perks) ? g.perks : [];
                    return {
                        ...g,
                        perks: perks.map(p => {
                            const v = p?.business_id ? vMap.get(String(p.business_id)) : null;
                            if (!v) return p;
                            return {
                                ...p,
                                vendor: {
                                    business_id: v.business_id,
                                    business_name: v.business_name,
                                    address: v.address,
                                    maps_url: v.maps_url
                                }
                            };
                        })
                    };
                });

                return res.json(enriched2);
            }
        }

        return res.json(enriched);

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
// ----------------------------------------------------------------------------------
// GET /api/shopify/products?search=beer
// ----------------------------------------------------------------------------------
app.get('/api/shopify/products', async (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const products = await listProducts({ search, limit: 20 });

        // normalize to what the frontend actually needs
        const normalized = products.map(p => ({
            id: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status,
            image: p.images?.[0]?.src || null,
            variants: (p.variants || []).map(v => ({
                id: v.id,
                title: v.title,
                sku: v.sku,
                price: v.price,
            }))
        }));

        res.json({ ok: true, products: normalized });
    } catch (err) {
        console.error('Error fetching Shopify products', err.response?.data || err);
        res.status(500).json({ ok: false, error: 'SHOPIFY_PRODUCTS_ERROR' });
    }
});
// -----------------------------------------------------------------------------
// GET /api/grams/:gramId/products
// -----------------------------------------------------------------------------
app.get('/api/producer/grams/:gramId/products', async (req, res) => {
    const { gramId } = req.params;

    try {
        const { data, error } = await supabase
            .from('gram_product_links')
            .select('*')
            .eq('gram_id', gramId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Optionally: fetch fresh product details from Shopify
        // For Phase 1, we just return raw IDs; UI will call /api/shopify/products?ids=...
        res.json({ ok: true, links: data });
    } catch (err) {
        console.error('Error loading gram products', err);
        res.status(500).json({ ok: false, error: 'GRAM_PRODUCTS_LOAD_ERROR' });
    }
});

// -----------------------------------------------------------------------------
// Producer-only: View claim audit history for a Gram
// GET /api/producer/grams/:gramId/claims
// -----------------------------------------------------------------------------
app.get("/api/producer/grams/:gramId/claims", requireAdmin, async (req, res) => {
    try {
        const gramId = String(req.params.gramId || "").trim();
        if (!gramId) return res.status(400).json({ ok: false, error: "MISSING_GRAM_ID" });

        const { data, error } = await supabase
            .from("gram_claims")
            .select("*")
            .eq("gram_id", gramId)
            .order("created_at", { ascending: false })
            .limit(200);

        if (error) throw error;

        return res.json({ ok: true, claims: data || [] });
    } catch (err) {
        console.error("Load gram_claims error:", err);
        return res.status(500).json({ ok: false, error: "CLAIMS_LOAD_ERROR" });
    }
});


// POST /api/grams/:gramId/products
// body: { shopify_product_id, shopify_variant_id }
app.post('/api/producer/grams/:gramId/products', async (req, res) => {
    const { gramId } = req.params;
    const { shopify_product_id, shopify_variant_id = null } = req.body;

    if (!shopify_product_id) {
        return res.status(400).json({ ok: false, error: 'MISSING_PRODUCT_ID' });
    }

    try {
        const { data, error } = await supabase
            .from('gram_product_links')
            .insert({
                gram_id: gramId,
                shopify_product_id,
                shopify_variant_id,
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ ok: true, link: data });
    } catch (err) {
        console.error('Error linking product to gram', err);
        res.status(500).json({ ok: false, error: 'GRAM_PRODUCT_LINK_ERROR' });
    }
});

// Sync Gram metadata into Shopify product metafields
app.post('/api/producer/grams/:gramId/shopify-metafields', async (req, res) => {
    try {
        const { gramId } = req.params;

        const { data: gram, error } = await supabase
            .from('grams')
            .select('*')
            .eq('id', gramId)
            .single();

        if (error || !gram) return res.status(404).json({ ok: false, error: 'Gram not found' });
        if (!gram.shopify_product_id) {
            return res.status(400).json({ ok: false, error: 'Gram not linked to Shopify product yet' });
        }

        const metafields = await syncGramMetafieldsToShopify(gram);
        return res.json({ ok: true, metafields });
    } catch (e) {
        console.error('Metafields sync error:', e.response?.data || e.message || e);
        return res.status(500).json({ ok: false, error: 'Failed to sync metafields' });
    }
});


// DELETE /api/grams/:gramId/products/:linkId
app.delete('/api/producer/grams/:gramId/products/:linkId', async (req, res) => {
    const { gramId, linkId } = req.params;

    try {
        const { error } = await supabase
            .from('gram_product_links')
            .delete()
            .eq('id', linkId)
            .eq('gram_id', gramId);

        if (error) throw error;

        res.json({ ok: true });
    } catch (err) {
        console.error('Error unlinking product from gram', err);
        res.status(500).json({ ok: false, error: 'GRAM_PRODUCT_UNLINK_ERROR' });
    }
});

// Create Shopify product from an existing Gram
// POST /api/producer/grams/:gramId/shopify-product
// body: { price: number, status?: 'active' | 'draft' }
app.post('/api/producer/grams/:gramId/shopify-product', async (req, res) => {
    const { gramId } = req.params;
    const {
        price,
        status = 'active',
        vendor = 'A Gram of Art',
        product_type = 'Gram',
        extra_tags = [],
        seo_title = null,
        seo_description = null,
        extra_images = [],
        collection_ids = [],
    } = req.body || {};

    if (!price || isNaN(Number(price))) {
        return res.status(400).json({ ok: false, error: 'INVALID_PRICE' });
    }

    try {
        const gram = await db.getGramById(gramId);
        if (!gram) {
            return res.status(404).json({ ok: false, error: 'GRAM_NOT_FOUND' });
        }

        if (gram.shopify_product_id) {
            return res.status(409).json({
                ok: false,
                error: 'PRODUCT_ALREADY_CREATED',
                product_id: gram.shopify_product_id,
            });
        }

        // 1) create product on Shopify
        const {
            price,
            status = 'active',
            vendor = 'A Gram of Art',
            product_type = 'Gram',
            extra_tags = [],
            seo_title = null,
            seo_description = null,
            extra_images = [],
            collection_ids = [],
        } = req.body || {};

        const result = await createProductForGram(gram, {
            price,
            status,
            vendor,
            product_type,
            extra_tags,
            seo_title,
            seo_description,
            extra_images,
            collection_ids, // we'll use this after the product is created
        });

        // 2) store product / variant IDs on Gram
        const { data, error } = await supabase
            .from('grams')
            .update({
                shopify_product_id: result.product_id,
                shopify_variant_id: result.variant_id,
            })
            .eq('id', gramId)
            .select()
            .single();

        if (error) throw error;

        return res.json({
            ok: true,
            product_id: result.product_id,
            variant_id: result.variant_id,
            gram: data,
        });
    } catch (err) {
        console.error(
            'Error creating Shopify product for gram',
            err.response?.data || err
        );
        return res.status(500).json({
            ok: false,
            error: 'CREATE_GRAM_PRODUCT_ERROR',
            details: err.message || String(err),
        });
    }
});

// Update existing Shopify product for a Gram (sync edits)
app.put('/api/producer/grams/:gramId/shopify-product', async (req, res) => {
    try {
        const { gramId } = req.params;

        const {
            price = null,
            status = null,
            vendor = null,
            product_type = null,
            extra_tags = null,
            seo_title = null,
            seo_description = null,
            extra_images = null,
            replace_images = false,
        } = req.body || {};

        // Load gram
        const { data: gram, error } = await supabase
            .from('grams')
            .select('*')
            .eq('id', gramId)
            .single();

        if (error || !gram) return res.status(404).json({ error: 'Gram not found' });
        if (!gram.shopify_product_id) {
            return res.status(400).json({ error: 'This gram is not linked to a Shopify product yet.' });
        }

        const result = await updateProductForGram(gram, {
            product_id: gram.shopify_product_id,
            variant_id: gram.shopify_variant_id || null,
            price,
            status,
            vendor,
            product_type,
            extra_tags,
            seo_title,
            seo_description,
            extra_images,
            replace_images,
        });

        // optional: store sync timestamp
        await supabase
            .from('grams')
            .update({ last_shopify_sync_at: new Date().toISOString() })
            .eq('id', gramId);

        res.json({ ok: true, product: result.product });
    } catch (e) {
        console.error('Update Shopify product failed:', e.response?.data || e.message || e);
        res.status(500).json({ error: 'Failed to update Shopify product' });
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
        ... on MediaImage {
          image {
            url
          }
        }
        ... on GenericFile {
          url
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

    // Prefer direct image url if present (MediaImage)
    if (node.image && node.image.url) {
        return { status: null, url: node.image.url };
    }

    // GenericFile might have url or preview.image.url
    if (node.url) {
        return { status: null, url: node.url };
    }
    if (node.preview && node.preview.image && node.preview.image.url) {
        return { status: null, url: node.preview.image.url };
    }

    return { status: null, url: null };
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
        throw new Error('fileCreate failed: ' + JSON.stringify(errs));
    }

    const f = data.fileCreate.files[0];

    let id = f.id;
    let status = f.fileStatus;
    let url = (f.preview && f.preview.image && f.preview.image.url) || null;

    // If no URL yet, poll Shopify a bit to let processing finish
    if (!url) {
        for (let i = 0; i < 10; i++) {   // up to ~10 seconds total
            await new Promise(r => setTimeout(r, 1000));
            const info = await fetchMediaImageUrlById(id);
            if (info.url) {
                url = info.url;
                break;
            }
        }
    }

    if (!url) {
        console.warn('No CDN URL for file id', id, 'after polling. Status:', status);
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

// Get Existing Saved Grams from Backend
app.get('/api/producer/grams', async (req, res) => {
    const db = new SupabaseDB();

    try {
        const grams = await db.getAllGrams();
        return res.json({ ok: true, grams });
    } catch (err) {
        console.error('Failed to list grams:', err);
        return res.status(500).json({
            ok: false,
            error: 'Failed to list grams'
        });
    }
});

app.delete('/api/producer/grams/:id', async (req, res) => {
    const id = req.params.id;
    const db = new SupabaseDB();

    try {
        await db.deleteGram(id);
        return res.json({ ok: true });
    } catch (err) {
        console.error('Failed to delete Gram:', err);
        return res.status(500).json({
            ok: false,
            error: 'Failed to delete Gram',
            details: err.message || err
        });
    }
});

app.get('/api/producer/grams/by-id/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) {
        return res.status(400).json({ error: 'id is required' });
    }

    try {
        const gram = await db.getGramById(id);
        if (!gram) {
            return res.status(404).json({ error: 'Gram not found' });
        }
        return res.json(gram);
    } catch (err) {
        console.error('Error fetching gram by id:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});
// normalize url
function normalizeImageUrl(url) {
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


// Check if a Gram already exists for a given image_url
app.get('/api/producer/grams/by-image', async (req, res) => {
    const rawUrl = req.query.imageUrl;
    if (!rawUrl) {
        return res.status(400).json({ error: 'imageUrl query param is required' });
    }

    const normalized = normalizeImageUrl(rawUrl);

    try {
        const gram = await db.getGramByImageUrl(normalized);
        if (!gram) {
            return res.status(404).json({ error: 'No gram for this image' });
        }
        return res.json(gram);
    } catch (err) {
        console.error('Error fetching gram by imageUrl:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});


// -----------------------------------------------------------------------------
// Save or update a Gram from Producer UI
app.post('/api/producer/grams', async (req, res) => {
    const gram = req.body;
    console.log('Incoming Gram from Producer UI:', gram);

    if (!gram || !gram.id || !gram.slug || !gram.nfc_tag_id || !gram.title || !gram.image_url) {
        console.error('Missing required Gram fields');
        return res.status(400).json({ error: 'Missing required Gram fields' });
    }

    try {
        // Ensure perks is always an array (or empty)
        const incomingPerks = Array.isArray(gram.perks) ? gram.perks : [];

        // 1) Check if Gram already exists
        const existing = await db.getGramById(gram.id);
        console.log('Existing gram for id', gram.id, ':', existing ? 'YES' : 'NO');

        let saved;

        if (existing) {
            // --- UPDATE MODE ---
            // Do NOT touch owner_id here; keep current owner
            const updatePayload = {
                slug: gram.slug,
                nfc_tag_id: gram.nfc_tag_id,
                title: gram.title,
                image_url: gram.image_url,
                description: gram.description || '',
                effects: gram.effects || {},
                perks: incomingPerks.length ? incomingPerks : []  // overwrite perks
            };

            console.log('Updating gram with payload:', updatePayload);

            saved = await db.updateGram(gram.id, updatePayload);
            console.log('Gram updated OK:', saved.id);
        } else {
            // --- CREATE MODE ---
            const createPayload = {
                id: gram.id,
                slug: gram.slug,
                nfc_tag_id: gram.nfc_tag_id,
                title: gram.title,
                image_url: gram.image_url,
                description: gram.description || '',
                effects: gram.effects || {},
                owner_id: gram.owner_id || null, // usually null from Producer
                perks: incomingPerks
            };

            console.log('Creating gram with payload:', createPayload);

            saved = await db.createGram(createPayload);
            console.log('Gram created OK:', saved.id);
        }

        // ✅ NEW: sync normalized perks table + rebuild grams.perks snapshot
        try {
            await db.replacePerksForGram(saved.id, incomingPerks);
            saved = await db.rebuildGramPerksSnapshot(saved.id);
        } catch (syncErr) {
            console.error('Perks sync/rebuild failed (non-fatal for gram save):', syncErr);
            // If you prefer strict: return 500 here. For now we keep gram save resilient.
        }

        // ✅ NEW (Checkpoint 11.0 Part A):
        // Sync normalized perks table + rebuild grams.perks snapshot
        try {
            await db.replacePerksForGram(saved.id, incomingPerks);
            saved = await db.rebuildGramPerksSnapshot(saved.id);
        } catch (syncErr) {
            console.error('Perks sync/rebuild failed (non-fatal for gram save):', syncErr);
        }

        return res.json({ ok: true, gram: saved });


    } catch (err) {
        console.error('Error saving Gram:', err);
        // Try to give the frontend more useful info
        return res.status(500).json({
            error: 'Failed to save Gram',
            details: err.message || String(err)
        });
    }
});

// Perks stay in shop and applied on the checkout in Shopify

app.post("/api/perks/redeem", async (req, res) => {
    const startedAt = Date.now();

    try {
        const { gram_id, perk_id, redeemer_fingerprint, redeemer_customer_id } = req.body;

        console.log("[redeem] START", { gram_id, perk_id });

        if (!gram_id || !perk_id) {
            console.log("[redeem] missing gram_id/perk_id");
            return res.status(400).json({ ok: false, error: "Missing gram_id or perk_id" });
        }

        const redeemerKey =
            redeemer_customer_id
                ? `customer:${redeemer_customer_id}`
                : (redeemer_fingerprint ||
                    crypto.createHash("sha256").update(req.ip || "anon").digest("hex"));;

        console.log("[redeem] fingerprint", redeemerKey.slice(0, 8) + "...");

        // load gram (and perks)
        console.log("[redeem] loading gram from Supabase");
        const { data: gram, error } = await supabase
            .from("grams")
            .select("*")
            .eq("id", gram_id)
            .single();

        if (error || !gram) {
            console.log("[redeem] gram not found", error);
            return res.status(404).json({ ok: false, error: "Gram not found" });
        }

        console.log("[redeem] gram loaded", { id: gram.id, perksCount: Array.isArray(gram.perks) ? gram.perks.length : 0 });

        const perks = Array.isArray(gram.perks) ? gram.perks : [];
        const perk = [...perks].reverse().find(p => p.id === perk_id);

        if (!perk) {
            console.log("[redeem] perk not found on gram", perk_id);
            return res.status(404).json({ ok: false, error: "Perk not found on gram" });
        }

        console.log("[redeem] perk found", { type: perk.type, cooldown: perk.cooldown_seconds, metadata: perk.metadata });

        const cooldown = Number(perk.cooldown_seconds || 0);
        // ------------------------
        // Usage limit (one-time / N-times) check
        // ------------------------
        const usageLimit = Number(perk?.metadata?.usage_limit || 0);

        if (usageLimit > 0) {
            const { count, error: countErr } = await supabase
                .from("redemptions")
                .select("id", { count: "exact", head: true })
                .eq("gram_id", gram_id)
                .eq("perk_id", perk_id)
                .eq("redeemer_fingerprint", redeemerKey)
                .eq("status", "consumed");


            if (countErr) {
                console.log("[redeem] usage_limit count error", countErr);
                return res.status(500).json({ ok: false, error: "Failed to check usage limit" });
            }

            if ((count || 0) >= usageLimit) {
                console.log("[redeem] USAGE_LIMIT_REACHED", { usageLimit, used: count });
                return res.status(409).json({
                    ok: false,
                    error: "USAGE_LIMIT_REACHED",
                    usage_limit: usageLimit,
                    used_count: count || 0,
                });
            }
        }


        // cooldown check
        console.log("[redeem] checking cooldown");
        const { data: last, error: lastErr } = await supabase
            .from("redemptions")
            .select("redeemed_at")
            .eq("gram_id", gram_id)
            .eq("perk_id", perk_id)
            .eq("redeemer_fingerprint", redeemerKey)
            .eq("status", "consumed")
            .order("redeemed_at", { ascending: false })
            .limit(1);

        if (lastErr) console.log("[redeem] cooldown query error", lastErr);

        if (last?.length) {
            const lastTime = new Date(last[0].redeemed_at).getTime();
            const now = Date.now();

            if (cooldown > 0 && now - lastTime < cooldown * 1000) {
                const remaining = Math.ceil((cooldown * 1000 - (now - lastTime)) / 1000);
                console.log("[redeem] COOLDOWN active", { remaining });
                return res.status(429).json({ ok: false, error: "COOLDOWN", remaining_seconds: remaining });
            }
        }

        // generate a unique code
        const code = `GRAM-${gram_id}-${perk_id}-${crypto.randomBytes(3).toString("hex")}`.toUpperCase();
        const title = perk?.metadata?.title || `Gram perk ${gram_id} ${perk_id}`;

        console.log("[redeem] generated code", code);

        let discountNodeId = null;
        let checkoutUrl = null;

        // Create discount based on perk type
        if (perk.type === "shopify_discount") {
            console.log("[redeem] creating BASIC discount in Shopify");

            const kind = perk.metadata?.kind || "percent";
            const value = perk.metadata?.value;

            if (value == null) {
                console.log("[redeem] missing discount value");
                return res.status(400).json({ ok: false, error: "Missing discount value" });
            }

            discountNodeId = await createBasicDiscountCode({
                code,
                title,
                kind,
                value,
                usageLimit: perk.metadata?.usage_limit ?? 1,
            });

            console.log("[redeem] BASIC discount created", { discountNodeId });

            const shop = process.env.SHOP_DOMAIN || "https://www.soldacstudio.com";
            checkoutUrl = `${shop}/discount/${encodeURIComponent(code)}?redirect=/cart`;
        }

        else if (perk.type === "shopify_free_product") {
            const variantId = perk.metadata?.variant_id;
            const qty = Number(perk.metadata?.quantity ?? 1);

            if (!variantId) {
                return res.status(400).json({ ok: false, error: "Missing variant_id" });
            }

            discountNodeId = await createFreeProduct100DiscountCode({
                code,
                title,
                variantIdNumeric: String(variantId),
                usageLimit: perk.metadata?.usage_limit ?? 1,
                appliesOncePerCustomer: true,
            });

            const shop = process.env.SHOP_DOMAIN || "https://www.soldacstudio.com";
            checkoutUrl = `${shop}/cart/${variantId}:${qty}?discount=${encodeURIComponent(code)}`;
        }

        if (!checkoutUrl) {
            console.log("[redeem] unsupported perk type or checkoutUrl not set", perk.type);
            return res.status(400).json({ ok: false, error: "Unsupported perk type" });
        }

        // record redemption (THIS is what enables cooldown + one-time)
        console.log("[redeem] inserting redemption row");
        const { error: insErr } = await supabase.from("redemptions").insert({
            gram_id,
            perk_id,
            redeemer_fingerprint: redeemerKey,
            shopify_discount_code: code,
            status: "issued",
            metadata: { discountNodeId, type: perk.type },
        });

        if (insErr) {
            console.log("[redeem] redemption insert error", insErr);
            return res.status(500).json({ ok: false, error: "Failed to record redemption", details: insErr });
        }

        console.log("[redeem] SUCCESS", { ms: Date.now() - startedAt, checkoutUrl });

        return res.json({
            ok: true,
            code,
            checkout_url: checkoutUrl,
            redirect_url: checkoutUrl,
        });



    } catch (e) {
        const details = e?.response?.data || e?.message || String(e);
        console.error("[redeem] FAILED", { ms: Date.now() - startedAt });
        console.error("Perk redeem error:", details);

        return res.status(500).json({
            ok: false,
            error: "Failed to redeem perk",
            details



        });
    }
});
/// -------------- Shopify WebHook endpointy for orders validation
function verifyShopifyWebhook(req) {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256") || "";
    if (!secret || !hmacHeader || !req.rawBody) return false;

    const digest = crypto
        .createHmac("sha256", secret)
        .update(req.rawBody)
        .digest("base64");

    try {
        return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
    } catch (_) {
        return false;
    }
}

app.post("/api/webhooks/shopify/orders/paid", async (req, res) => {
    try {
        if (!verifyShopifyWebhook(req)) {
            return res.status(401).send("Invalid webhook signature");
        }

        const order = req.body;
        const orderId = order?.id ? String(order.id) : null;

        const codes = Array.isArray(order?.discount_codes)
            ? order.discount_codes.map(d => (d?.code || "").toString().trim()).filter(Boolean)
            : [];

        if (!codes.length) return res.status(200).json({ ok: true, consumed: 0 });

        let consumed = 0;

        for (const code of codes) {
            const { data, error } = await supabase
                .from("redemptions")
                .update({
                    status: "consumed",
                    consumed_at: new Date().toISOString(),
                    order_id: orderId
                })
                .eq("shopify_discount_code", code)
                .eq("status", "issued")
                .select("id");

            if (error) {
                console.error("[orders/paid webhook] update error", { code, error });
                continue;
            }

            consumed += (data?.length || 0);
        }

        return res.status(200).json({ ok: true, consumed });
    } catch (e) {
        console.error("[orders/paid webhook] FAILED", e);
        return res.status(200).send("ok");
    }
});


// -----------------------------------------------------------------------------
// Vendor API (Checkpoint 11.1 / Option A)
// Minimal partner endpoints for managing perks by business_id
// -----------------------------------------------------------------------------
//
// Auth model (Phase 1):
// - Vendor sends business_id (query param for GET, JSON body for POST).
// - Server enforces that business_id matches the perk row being mutated.
// - Later we can add vendor tokens / signed links without changing the API shape.
//

function requireBusinessId(req) {
    const businessId =
        (req.query.business_id || "").trim() ||
        (req.body?.business_id || "").trim() ||
        (req.headers["x-business-id"] || "").toString().trim();

    return businessId || null;
}
function cleanHttpUrl(u) {
    const s = String(u || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) return null;
    return s;
}

// Get /api/vendor/profile
app.get("/api/vendor/profile", requireVendor, async (req, res) => {
    try {
        const v = req.vendor;
        return res.json({
            ok: true,
            vendor: {
                business_id: v.business_id,
                business_name: v.business_name,
                address: v.address,
                maps_url: v.maps_url,
                lat: v.lat,
                lng: v.lng,
            }
        });
    } catch (err) {
        console.error("GET /api/vendor/profile error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_PROFILE_READ_ERROR" });
    }
});
// PUT /api/vendor/profile
app.put("/api/vendor/profile", requireVendor, async (req, res) => {
    try {
        const business_id = req.vendor.business_id;

        const business_name = String(req.body?.business_name || "").trim() || null;
        const address = String(req.body?.address || "").trim() || null;
        const maps_url = cleanHttpUrl(req.body?.maps_url);

        const patch = {
            business_name,
            address,
            maps_url,
            updated_at: new Date().toISOString(),
        };

        const { data: updated, error } = await supabase
            .from("vendors")
            .update(patch)
            .eq("business_id", business_id)
            .select("business_id,business_name,address,maps_url,lat,lng,updated_at")
            .single();

        if (error) throw error;

        return res.json({ ok: true, vendor: updated });
    } catch (err) {
        console.error("PUT /api/vendor/profile error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_PROFILE_UPDATE_ERROR" });
    }
});


// GET /api/vendor/perks?business_id=Bar11
// Optional: &gram_id=G002  (to narrow)
app.get("/api/vendor/perks", requireVendor, async (req, res) => {
    try {
        const businessId = req.vendor.business_id;
        const gramId = (req.query.gram_id || "").trim() || null;

        if (!businessId) {
            return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        }

        let q = supabase
            .from("perks")
            .select("id, gram_id, perk_id, business_id, business_name, type, metadata, cooldown_seconds, enabled, created_at, updated_at")
            .eq("business_id", businessId)
            .order("created_at", { ascending: false });

        if (gramId) q = q.eq("gram_id", gramId);

        const { data, error } = await q;
        if (error) throw error;

        return res.json({ ok: true, perks: data || [] });
    } catch (err) {
        console.error("Vendor perks list error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_PERKS_LIST_ERROR" });
    }
});
    
// POST /api/vendor/perks/:id/enable
// body: { business_id: "Bar11" }
app.post("/api/vendor/perks/:id/enable", requireVendor, async (req, res) => {
    try {
        const businessId = req.vendor.business_id;
        const perkRowId = req.params.id;

        if (!businessId) {
            return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        }
        if (!perkRowId) {
            return res.status(400).json({ ok: false, error: "MISSING_PERK_ROW_ID" });
        }

        // 1) Load perk row
        const { data: perk, error: pErr } = await supabase
            .from("perks")
            .select("*")
            .eq("id", perkRowId)
            .single();

        if (pErr || !perk) {
            return res.status(404).json({ ok: false, error: "PERK_NOT_FOUND" });
        }

        // 2) Enforce vendor boundary
        if (String(perk.business_id) !== String(businessId)) {
            return res.status(403).json({ ok: false, error: "FORBIDDEN" });
        }

        // 3) Update enabled flag
        const { data: updatedPerk, error: uErr } = await supabase
            .from("perks")
            .update({ enabled: true, updated_at: new Date().toISOString() })
            .eq("id", perkRowId)
            .select("*")
            .single();

        if (uErr) throw uErr;

        // 4) Rebuild grams.perks snapshot for this gram (runtime contract)
        const db = new SupabaseDB();
        const updatedGram = await db.rebuildGramPerksSnapshot(updatedPerk.gram_id);

        return res.json({ ok: true, perk: updatedPerk, gram: updatedGram });
    } catch (err) {
        console.error("Vendor perk enable error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_PERK_ENABLE_ERROR" });
    }
});

// POST /api/vendor/perks/:id/disable
// body: { business_id: "Bar11" }
app.post("/api/vendor/perks/:id/disable", requireVendor, async (req, res) => {
    try {
        const businessId = req.vendor.business_id;
        const perkRowId = req.params.id;

        if (!businessId) {
            return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        }
        if (!perkRowId) {
            return res.status(400).json({ ok: false, error: "MISSING_PERK_ROW_ID" });
        }

        // 1) Load perk row
        const { data: perk, error: pErr } = await supabase
            .from("perks")
            .select("*")
            .eq("id", perkRowId)
            .single();

        if (pErr || !perk) {
            return res.status(404).json({ ok: false, error: "PERK_NOT_FOUND" });
        }

        // 2) Enforce vendor boundary
        if (String(perk.business_id) !== String(businessId)) {
            return res.status(403).json({ ok: false, error: "FORBIDDEN" });
        }

        // 3) Update enabled flag
        const { data: updatedPerk, error: uErr } = await supabase
            .from("perks")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", perkRowId)
            .select("*")
            .single();

        if (uErr) throw uErr;

        // 4) Rebuild grams.perks snapshot for this gram (runtime contract)
        const db = new SupabaseDB();
        const updatedGram = await db.rebuildGramPerksSnapshot(updatedPerk.gram_id);

        return res.json({ ok: true, perk: updatedPerk, gram: updatedGram });
    } catch (err) {
        console.error("Vendor perk disable error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_PERK_DISABLE_ERROR" });
    }
});

// Create/refresh vendor session cookie (device becomes "vendor device")
app.post("/api/vendor/session", requireVendor, async (req, res) => {
    try {
        const bid = String(req.vendor?.business_id || "").trim();
        if (!bid) return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });

        const token = signVendorSession(bid);

        // Cookie works because vendor UI + /t/:tag are served from SAME backend domain
        res.cookie(VENDOR_SESSION_COOKIE, token, {
            httpOnly: true,
            sameSite: "Lax",
            secure: true,          // Render is https
            maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
            path: "/",
        });

        return res.json({ ok: true, business_id: bid });
    } catch (err) {
        console.error("Vendor session error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_SESSION_ERROR" });
    }
});

// Debug: check if this device has an active vendor session cookie
app.get("/api/vendor/session/status", (req, res) => {
    const sess = readCookie(req, VENDOR_SESSION_COOKIE);
    const business_id = verifyVendorSession(sess);
    return res.json({
        ok: true,
        has_cookie: !!sess,
        business_id: business_id || null,
        // handy for debugging in logs; do not expose in production if you dislike:
        cookie_sample: sess ? String(sess).slice(0, 18) + "…" : null
    });
});

// Optional: logout / clear cookie
app.post("/api/vendor/logout", (req, res) => {
    res.clearCookie(VENDOR_SESSION_COOKIE, { path: "/" });
    return res.json({ ok: true });
});



// -----------------------------------------------------------------------------
// Vendor API: Create / Update / Delete perks
// -----------------------------------------------------------------------------
function assertVendorAllowedPerkType(vendorBusinessId, type) {
    const t = String(type || "");
    if (t.startsWith("shopify_") && String(vendorBusinessId) !== String(SOLDAC_BUSINESS_ID)) {
        const e = new Error("FORBIDDEN_SHOPIFY_PERK_TYPE");
        e.status = 403;
        throw e;
    }
}

function validateVendorPerkInput(input) {
    const out = {};

    // required
    out.gram_id = String(input.gram_id || "").trim();
    out.business_id = String(input.business_id || "").trim();
    out.type = String(input.type || "").trim();

    if (!out.gram_id) throw new Error("MISSING_GRAM_ID");
    if (!out.business_id) throw new Error("MISSING_BUSINESS_ID");
    if (!out.type) throw new Error("MISSING_TYPE");

    // optional
    out.business_name = (input.business_name || "").toString().trim() || null;
    out.enabled = (input.enabled === undefined ? true : !!input.enabled);
    out.cooldown_seconds = Number(input.cooldown_seconds || 0);
    if (isNaN(out.cooldown_seconds) || out.cooldown_seconds < 0) throw new Error("INVALID_COOLDOWN");

    // metadata
    out.metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};

    // Type-specific guardrails (keep minimal, aligned with your current perk types)
    if (out.type === "shopify_discount") {
        const kind = out.metadata.kind || "percent";
        const value = out.metadata.value;
        if (!["percent", "fixed"].includes(kind)) throw new Error("INVALID_DISCOUNT_KIND");
        if (value == null || isNaN(Number(value))) throw new Error("MISSING_DISCOUNT_VALUE");
    }

    if (out.type === "shopify_free_product") {
        const variantId = out.metadata.variant_id;
        if (!variantId) throw new Error("MISSING_VARIANT_ID");
        const qty = out.metadata.quantity ?? 1;
        if (isNaN(Number(qty)) || Number(qty) <= 0) throw new Error("INVALID_QUANTITY");
    }

    return out;
}

// POST /api/vendor/perks
// body: { business_id, gram_id, business_name?, type, cooldown_seconds?, enabled?, metadata? }
app.post("/api/vendor/perks", requireVendor, async (req, res) => {
    try {
        const businessId = req.vendor.business_id;
        if (!businessId) return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });

        const input = validateVendorPerkInput({ ...req.body, business_id: businessId });

        // Confirm vendor boundary (business_id from auth must match payload)
        if (String(input.business_id) !== String(businessId)) {
            return res.status(403).json({ ok: false, error: "FORBIDDEN" });
        }

        // Generate a stable perk_id for snapshot + redeem usage
        // (This is the "p.id" you already use in grams.perks)
        const perk_id = `PERK-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`.toUpperCase();

        const row = {
            gram_id: input.gram_id,
            perk_id,
            business_id: input.business_id,
            business_name: input.business_name,
            type: input.type,
            metadata: input.metadata,
            cooldown_seconds: input.cooldown_seconds,
            enabled: input.enabled,
            updated_at: new Date().toISOString(),
        };

        const { data: created, error } = await supabase
            .from("perks")
            .insert(row)
            .select("*")
            .single();

        if (error) throw error;

        // rebuild snapshot
        const db = new SupabaseDB();
        const updatedGram = await db.rebuildGramPerksSnapshot(created.gram_id);

        return res.json({ ok: true, perk: created, gram: updatedGram });
    } catch (err) {
        console.error("Vendor perk create error:", err);
        return res.status(400).json({ ok: false, error: err.message || "VENDOR_PERK_CREATE_ERROR" });
    }
});

// PUT /api/vendor/perks/:id
// body: { business_id, business_name?, cooldown_seconds?, enabled?, metadata?, type? }
// Note: allow editing type only if you want; currently allowed here but can be locked down.
app.put("/api/vendor/perks/:id", requireVendor, async (req, res) => {
    try {
        const businessId = req.vendor.business_id;
        const perkRowId = req.params.id;

        if (!businessId) return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        if (!perkRowId) return res.status(400).json({ ok: false, error: "MISSING_PERK_ROW_ID" });

        // Load perk row
        const { data: perk, error: pErr } = await supabase
            .from("perks")
            .select("*")
            .eq("id", perkRowId)
            .single();

        if (pErr || !perk) return res.status(404).json({ ok: false, error: "PERK_NOT_FOUND" });

        // vendor boundary
        if (String(perk.business_id) !== String(businessId)) {
            return res.status(403).json({ ok: false, error: "FORBIDDEN" });
        }

        // Merge incoming with existing so validation can run safely
        const merged = {
            gram_id: perk.gram_id,
            business_id: businessId,
            business_name: req.body.business_name ?? perk.business_name,
            type: req.body.type ?? perk.type,
            cooldown_seconds: req.body.cooldown_seconds ?? perk.cooldown_seconds,
            enabled: req.body.enabled ?? perk.enabled,
            metadata: req.body.metadata ?? perk.metadata,
        };
        // 🔒 Enforce type permissions on UPDATE too (Soldac-only for shopify_*)
        assertVendorAllowedPerkType(businessId, merged.type);

        const input = validateVendorPerkInput(merged);

        const patch = {
            business_name: input.business_name,
            type: input.type,
            metadata: input.metadata,
            cooldown_seconds: input.cooldown_seconds,
            enabled: input.enabled,
            updated_at: new Date().toISOString(),
        };

        const { data: updatedPerk, error: uErr } = await supabase
            .from("perks")
            .update(patch)
            .eq("id", perkRowId)
            .select("*")
            .single();

        if (uErr) throw uErr;

        const db = new SupabaseDB();
        const updatedGram = await db.rebuildGramPerksSnapshot(updatedPerk.gram_id);

        return res.json({ ok: true, perk: updatedPerk, gram: updatedGram });
    } catch (err) {
        console.error("Vendor perk update error:", err);
        return res.status(400).json({ ok: false, error: err.message || "VENDOR_PERK_UPDATE_ERROR" });
    }
});



// DELETE /api/vendor/perks/:id
// body: { business_id }
app.delete("/api/vendor/perks/:id", requireVendor, async (req, res) => {
    try {
        const businessId = req.vendor.business_id;
        const perkRowId = req.params.id;

        if (!businessId) return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });
        if (!perkRowId) return res.status(400).json({ ok: false, error: "MISSING_PERK_ROW_ID" });

        // Load perk
        const { data: perk, error: pErr } = await supabase
            .from("perks")
            .select("*")
            .eq("id", perkRowId)
            .single();

        if (pErr || !perk) return res.status(404).json({ ok: false, error: "PERK_NOT_FOUND" });

        if (String(perk.business_id) !== String(businessId)) {
            return res.status(403).json({ ok: false, error: "FORBIDDEN" });
        }

        const gramId = perk.gram_id;

        const { error: dErr } = await supabase
            .from("perks")
            .delete()
            .eq("id", perkRowId);

        if (dErr) throw dErr;

        const db = new SupabaseDB();
        const updatedGram = await db.rebuildGramPerksSnapshot(gramId);

        return res.json({ ok: true, deleted: true, gram: updatedGram });
    } catch (err) {
        console.error("Vendor perk delete error:", err);
        return res.status(400).json({ ok: false, error: err.message || "VENDOR_PERK_DELETE_ERROR" });
    }
});
// GET with just /vendor/validate no need for .html
app.get('/vendor/validate', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect('/vendor/validate.html' + qs);
});

// GET /api/vendor/validate?nfcTagId=...
// headers: X-Business-Id, X-Vendor-Secret
app.get("/api/vendor/validate", requireVendor, async (req, res) => {
    try {
        const nfcTagId = String(req.query.nfcTagId || req.query.tag || "").trim();
        if (!nfcTagId) return res.status(400).json({ ok: false, error: "MISSING_NFC_TAG_ID" });

        const db = new SupabaseDB();
        const gram = await db.getGramByTag(nfcTagId);
        if (!gram) return res.status(404).json({ ok: false, error: "GRAM_NOT_FOUND" });

        const vendor = req.vendor;
        const perks = Array.isArray(gram.perks) ? gram.perks : [];

        // only perks for this vendor + only in-person types (partners shouldn't see shopify perks)
        const vendorPerks = perks.filter(p =>
            String(p.business_id) === String(vendor.business_id) &&
            !String(p.type || "").startsWith("shopify_")
        );

        // compute cooldown state per perk (per gram/perk/business)
        const now = Date.now();

        const computed = [];
        for (const p of vendorPerks) {
            const cooldown = Number(p.cooldown_seconds || 0);

            const { data: lastRows, error } = await supabase
                .from("perk_redemptions")
                .select("redeemed_at")
                .eq("gram_id", String(gram.id))
                .eq("perk_id", String(p.id))
                .eq("business_id", String(vendor.business_id))
                .order("redeemed_at", { ascending: false })
                .limit(1);

            if (error) throw error;

            const lastAt = lastRows?.[0]?.redeemed_at ? new Date(lastRows[0].redeemed_at).getTime() : null;
            const remaining = lastAt && cooldown > 0 ? (lastAt + cooldown * 1000) - now : 0;

            computed.push({
                ...p,
                state: remaining > 0 ? "cooldown" : "available",
                cooldown_remaining_ms: Math.max(0, remaining),
                last_redeemed_at: lastRows?.[0]?.redeemed_at || null,
            });
        }

        return res.json({
            ok: true,
            vendor: {
                business_id: vendor.business_id,
                business_name: vendor.business_name,
                address: vendor.address,
                maps_url: vendor.maps_url,
                lat: vendor.lat,
                lng: vendor.lng,
            },
            gram: {
                id: gram.id,
                title: gram.title,
                image_url: gram.image_url,
                nfc_tag_id: gram.nfc_tag_id,
            },
            perks: computed,
        });
    } catch (err) {
        console.error("Vendor validate GET error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_VALIDATE_ERROR" });
    }
});
// POST /api/vendor/validate/approve
// body: { nfcTagId, perk_id }
// headers: X-Business-Id, X-Vendor-Secret
app.post("/api/vendor/validate/approve", requireVendor, async (req, res) => {
    try {
        const nfcTagId = String(req.body?.nfcTagId || req.body?.tag || "").trim();
        const perk_id = String(req.body?.perk_id || "").trim();
        if (!nfcTagId) return res.status(400).json({ ok: false, error: "MISSING_NFC_TAG_ID" });
        if (!perk_id) return res.status(400).json({ ok: false, error: "MISSING_PERK_ID" });

        const vendor = req.vendor;

        const db = new SupabaseDB();
        const gram = await db.getGramByTag(nfcTagId);
        if (!gram) return res.status(404).json({ ok: false, error: "GRAM_NOT_FOUND" });

        const perks = Array.isArray(gram.perks) ? gram.perks : [];
        const perk = perks.find(p => String(p.id) === String(perk_id));
        if (!perk) return res.status(404).json({ ok: false, error: "PERK_NOT_FOUND_ON_GRAM" });

        // vendor boundary
        if (String(perk.business_id) !== String(vendor.business_id)) {
            return res.status(403).json({ ok: false, error: "FORBIDDEN" });
        }

        // disallow shopify_* through vendor validation
        if (String(perk.type || "").startsWith("shopify_")) {
            return res.status(403).json({ ok: false, error: "FORBIDDEN_SHOPIFY_PERK_VALIDATION" });
        }

        // cooldown check
        const cooldown = Number(perk.cooldown_seconds || 0);
        const { data: lastRows, error: lastErr } = await supabase
            .from("perk_redemptions")
            .select("redeemed_at")
            .eq("gram_id", String(gram.id))
            .eq("perk_id", String(perk.id))
            .eq("business_id", String(vendor.business_id))
            .order("redeemed_at", { ascending: false })
            .limit(1);

        if (lastErr) throw lastErr;

        const now = Date.now();
        const lastAt = lastRows?.[0]?.redeemed_at ? new Date(lastRows[0].redeemed_at).getTime() : null;
        if (lastAt && cooldown > 0) {
            const remaining = (lastAt + cooldown * 1000) - now;
            if (remaining > 0) {
                return res.status(429).json({
                    ok: false,
                    error: "ON_COOLDOWN",
                    cooldown_remaining_ms: remaining,
                    last_redeemed_at: lastRows[0].redeemed_at,
                });
            }
        }

        // log redemption
        const { data: ins, error: insErr } = await supabase
            .from("perk_redemptions")
            .insert({
                gram_id: String(gram.id),
                perk_id: String(perk.id),
                business_id: String(vendor.business_id),
                channel: "in_person",
                redeemer_customer_id: null,
            })
            .select("*")
            .single();

        if (insErr) throw insErr;

        return res.json({
            ok: true,
            redeemed: ins,
            gram_id: gram.id,
            perk_id: perk.id,
        });
    } catch (err) {
        console.error("Vendor approve error:", err);
        return res.status(500).json({ ok: false, error: "VENDOR_APPROVE_ERROR" });
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

// ----------------------------------------------------------------------------
// OpenAI API
// ----------------------------------------------------------------------------
app.get('/internal/test/openai', async (req, res) => {
    try {
        const OpenAI = require('openai');
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const response = await client.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'system', content: 'You are an assistant.' },
                { role: 'user', content: 'Say OK if this connection works.' }
            ]
        });

        res.json({ ok: true, reply: response.choices[0].message.content });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});
// ------------------------------------------------------------------
// internal route to create a Notion checkpoint using ChatGPT summary
// ------------------------------------------------------------------
app.post('/internal/checkpoint', async (req, res) => {
    try {
        const { Client } = require('@notionhq/client');
        const notion = new Client({ auth: process.env.NOTION_TOKEN });

        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const { text } = req.body;

        if (!text) {
            return res.status(400).json({ ok: false, error: 'text required' });
        }

        // Let ChatGPT summarize automatically
        const summaryRes = await openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'system', content: 'Summarize the following text professionally.' },
                { role: 'user', content: text }
            ]
        });

        const summary = summaryRes.choices[0].message.content;

        // Add to Notion database
        const page = await notion.pages.create({
            parent: { database_id: process.env.NOTION_CHECKPOINT_DB_ID },
            properties: {
                Name: { title: [{ text: { content: "Auto Checkpoint" } }] },
                Summary: { rich_text: [{ text: { content: summary } }] },
                Date: { date: { start: new Date().toISOString() } }
            }
        });

        res.json({ ok: true, notionPageId: page.id, summary });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});


// -----------------------------------------------------------------------------
// Claim a Gram for a given owner (customer)
// -----------------------------------------------------------------------------
app.post('/api/grams/claim', async (req, res) => {
    const { gramId, ownerId } = req.body || {};

    if (!gramId || !ownerId) {
        return res.status(400).json({ ok: false, error: "gramId and ownerId are required" });
    }

    const out = await db.claimOwnerIfUnclaimed(gramId, ownerId);

    if (out.status === "not_found") {
        return res.status(404).json({ ok: false, error: "GRAM_NOT_FOUND" });
    }

    if (out.status === "claimed") {
        return res.json({ ok: true, claimed: true, gram: out.gram });
    }

    if (out.status === "already_owned") {
        return res.json({ ok: true, alreadyOwned: true, gram: out.gram });
    }

    if (out.status === "already_claimed") {
        return res.status(409).json({ ok: false, error: "GRAM_ALREADY_CLAIMED" });
    }
    const ip =
        (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        null;

    const ua = (req.headers["user-agent"] || "").toString() || null;

    // Optional: if you want tag-aware audit later
    const nfc_tag_id = null;

    // Always log attempt (do not block response if logging fails)
    await db.logGramClaimAttempt({
        gram_id: gramId,
        owner_id: ownerId,
        status: out.status, // "claimed" | "already_owned" | "already_claimed" | "not_found"
        channel: "nfc",
        nfc_tag_id,
        previous_owner_id: out.gram?.owner_id ? String(out.gram.owner_id) : null,
        ip,
        user_agent: ua,
    });

    return res.status(500).json({ ok: false, error: "UNKNOWN_CLAIM_STATE" });
});
// -----------------------------------------------------------------------------
// Claim by NFC tag (convenience)
// POST /api/grams/claim-by-tag
// body: { nfcTagId, ownerId }
// -----------------------------------------------------------------------------
app.post('/api/grams/claim-by-tag', async (req, res) => {
    const { nfcTagId, ownerId } = req.body || {};
    if (!nfcTagId || !ownerId) {
        return res.status(400).json({ ok: false, error: 'nfcTagId and ownerId are required' });
    }

    try {
        const gram = await db.getGramByTag(nfcTagId);
        if (!gram) return res.status(404).json({ ok: false, error: 'Gram not found for this tag' });

        // Normalize owner value (treat "null", "", etc. as no owner)
        const rawOwner = gram.owner_id;
        const hasOwner =
            rawOwner !== null &&
            rawOwner !== undefined &&
            rawOwner !== '' &&
            rawOwner !== 'null' &&
            rawOwner !== 'undefined';

        if (hasOwner) {
            if (String(rawOwner) === String(ownerId)) {
                return res.json({ ok: true, alreadyOwned: true, gram });
            }
            return res.status(409).json({ ok: false, error: 'Gram already claimed by another owner' });
        }

        const updated = await db.setOwner(gram.id, ownerId);
        return res.json({ ok: true, claimed: true, gram: updated });
    } catch (err) {
        console.error('Error claiming Gram by tag:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

// -----------------------------------------------------------------------------
// Notion checkpoint route (internal)
// -----------------------------------------------------------------------------
app.post('/internal/notion/checkpoints', async (req, res) => {
    const { title, summary } = req.body || {};

    if (!title || !summary) {
        return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
    }

    try {
        const page = await createCheckpointPage({
            title,
            summary,
            date: new Date(),
        });

        return res.json({ ok: true, pageId: page.id });
    } catch (err) {
        console.error('Error creating Notion checkpoint page:', err);
        return res.status(500).json({
            ok: false,
            error: 'NOTION_CHECKPOINT_ERROR',
            details: err.message || String(err),
        });
    }
});
// -----------------------------------------------------------------------------
// Producer-only: Create vendor (stores hash, returns plaintext secret once)
// -----------------------------------------------------------------------------
app.post("/api/producer/vendors", requireAdmin, async (req, res) => {
    try {
        const business_id = String(req.body?.business_id || "").trim();
        const business_name = String(req.body?.business_name || "").trim() || null;

        const address = String(req.body?.address || "").trim() || null;
        const maps_url = String(req.body?.maps_url || "").trim() || null;
        const lat = req.body?.lat != null ? Number(req.body.lat) : null;
        const lng = req.body?.lng != null ? Number(req.body.lng) : null;

        if (!business_id) return res.status(400).json({ ok: false, error: "MISSING_BUSINESS_ID" });

        // Vendor secret (for Vendor UI auth)
        

        // Onboarding token (for one-click onboarding link / QR)
        const onboarding_token = makeOnboardingToken();
        const onboarding_token_hash = hashOnboardingToken(onboarding_token);

        // Where onboarding page lives
        // Option A: serve from your backend vendor-ui (recommended)
        // Example URL: https://.../vendor/onboard.html?business_id=...&token=...
        const vendorUiBase = process.env.VENDOR_UI_ORIGIN || "https://grams-backend-clean.onrender.com/vendor";
        const onboarding_url =
            `${vendorUiBase}/onboard.html?business_id=${encodeURIComponent(business_id)}&token=${encodeURIComponent(onboarding_token)}`;

        // QR as SVG (easy to render in Producer UI)
        const onboarding_qr_svg = await QRCode.toString(onboarding_url, { type: "svg" });

        const row = {
            business_id,
            business_name,
            secret_hash: null,
            address,
            maps_url,
            lat: isNaN(lat) ? null : lat,
            lng: isNaN(lng) ? null : lng,
            onboarding_token_hash,
            onboarding_url,
            onboarding_qr_svg,
            updated_at: new Date().toISOString(),
        };

        const { data: created, error } = await supabase
            .from("vendors")
            .insert(row)
            .select("business_id,business_name,address,maps_url,lat,lng,onboarding_url,onboarding_qr_svg,created_at,updated_at")
            .single();

        if (error) {
            if (String(error.message || "").toLowerCase().includes("duplicate")) {
                return res.status(409).json({ ok: false, error: "VENDOR_ALREADY_EXISTS" });
            }
            throw error;
        }

        // IMPORTANT: return plaintext secrets/tokens ONLY ONCE
        return res.json({
            ok: true,
            vendor: created,
            onboarding_url,
            onboarding_token,
            onboarding_qr_svg,
            note: "Save vendor_secret + onboarding link/QR now. Secrets/tokens are not recoverable later (only reset).",
        });
    } catch (err) {
        console.error("Create vendor error:", err);
        return res.status(500).json({ ok: false, error: "CREATE_VENDOR_ERROR" });
    }
});




// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log('Server running on', PORT);
});
