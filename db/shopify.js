// db/shopify.js
const axios = require('axios');

const SHOPIFY_STORE_DOMAIN =
    process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN; // e.g. soldacstudio.myshopify.com

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;           // same token you use for GraphQL
const SHOPIFY_ADMIN_VERSION = '2025-01';

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    console.warn('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars');
}

// ✅ timeouts (prevents hanging requests)
axios.defaults.timeout = 20000;

// ✅ create Shopify axios client AFTER token exists
const shopifyHttp = axios.create({
    timeout: 20000,
    headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
    }
});

/**
 * List Shopify products via REST Admin API.
 * Fetches a page of products, then optionally filters by title/handle.
 */
async function listProducts({ search = '', limit = 50 } = {}) {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/products.json`;

    const params = {
        limit: Math.min(limit, 250),
        fields: 'id,title,handle,images,variants,status',
        // status: 'active', // optional
    };

    const res = await axios.get(url, {
        headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
            'Content-Type': 'application/json',
        },
        params,
    });

    let products = res.data.products || [];

    if (search) {
        const q = search.toLowerCase();
        products = products.filter((p) => {
            const title = (p.title || '').toLowerCase();
            const handle = (p.handle || '').toLowerCase();
            return title.includes(q) || handle.includes(q);
        });
    }

    return products;
}

/**
 * Create a Shopify product for a given Gram.
 * Returns { product_id, variant_id, product }.
 */
async function createProductForGram(
    gram,
    {
        price,
        status = 'active',
        vendor = 'A Gram of Art',
        product_type = 'Gram',
        extra_tags = [],
        seo_title = null,
        seo_description = null,
        extra_images = [],
        collection_ids = [],
    } = {}
) {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
        throw new Error('Missing Shopify domain or admin token');
    }
    if (!gram || !gram.id) {
        throw new Error('Gram is required');
    }

    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/products.json`;

    // base tags for all Gram products
    const baseTags = [
        'gram-of-art',
        `gram-id:${gram.id}`,
    ];
    const tags = [...baseTags, ...extra_tags];

    // Build images array: main gram image + any extraImages
    const images = [];
    if (gram.image_url) {
        images.push({ src: gram.image_url });
    }
    for (const src of extra_images) {
        images.push({ src });
    }

    const payload = {
        product: {
            title: gram.title || gram.id,
            body_html: gram.description || '',
            status,
            handle: (gram.slug || gram.id).toLowerCase(),
            product_type,
            vendor,
            tags,
            images,
            // SEO fields – Shopify REST supports these meta fields on product
            metafields_global_title_tag: seo_title || undefined,
            metafields_global_description_tag: seo_description || undefined,
            variants: [
                {
                    price: String(price),
                    sku: gram.id,
                    inventory_management: null,
                },
            ],
        },
    };

    const res = await axios.post(url, payload, {
        headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
            'Content-Type': 'application/json',
        },
    });

    const product = res.data.product;
    if (!product) {
        throw new Error('No product returned from Shopify');
    }

    const firstVariant = (product.variants && product.variants[0]) || null;
    const product_id = product.id;
    const variant_id = firstVariant ? firstVariant.id : null;

    // Attach product to any manual collections (via Collects)
    if (collection_ids && collection_ids.length) {
        const collectsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/collects.json`;

        for (const collectionId of collection_ids) {
            try {
                await axios.post(
                    collectsUrl,
                    {
                        collect: {
                            collection_id: collectionId,
                            product_id: product_id,
                        },
                    },
                    {
                        headers: {
                            'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
                            'Content-Type': 'application/json',
                        },
                    }
                );
            } catch (err) {
                console.error(
                    'Failed to attach product to collection',
                    collectionId,
                    err.response?.data || err
                );
                // not fatal – we still return the product; you can handle collections later
            }
        }
    }

    return {
        product_id,
        variant_id,
        product,
    };
}
/**
 * Update an existing Shopify product for a given Gram.
 * Returns { product }.
 *
 * Supports:
 * - title, body_html, status, vendor, product_type, tags
 * - SEO fields
 * - images (main + extra)
 * - variant price (uses stored variant_id if provided, else first variant)
 */
async function updateProductForGram(
    gram,
    {
        product_id,
        variant_id = null,
        price = null,
        status = null,
        vendor = null,
        product_type = null,
        extra_tags = null,        // array or null (null = leave unchanged)
        seo_title = null,
        seo_description = null,
        extra_images = null,      // array or null (null = leave unchanged)
        replace_images = false,   // true = overwrite product images fully
    } = {}
) {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
        throw new Error('Missing Shopify domain or admin token');
    }
    if (!gram || !gram.id) {
        throw new Error('Gram is required');
    }
    if (!product_id) {
        throw new Error('product_id is required to update');
    }

    // 1) Fetch current product (so we can preserve fields if not provided)
    const getUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/products/${product_id}.json`;
    const existingRes = await axios.get(getUrl, {
        headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
            'Content-Type': 'application/json',
        },
    });

    const existing = existingRes.data.product;
    if (!existing) throw new Error('Product not found in Shopify');

    // 2) Tags: keep base tags always, optionally merge extras
    const baseTags = ['gram-of-art', `gram-id:${gram.id}`];

    let tagsString = existing.tags || '';
    if (Array.isArray(extra_tags)) {
        const currentTags = (existing.tags || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);

        const merged = Array.from(new Set([...baseTags, ...currentTags, ...extra_tags]));
        tagsString = merged.join(', ');
    } else {
        // ensure base tags exist even if we "leave unchanged"
        const currentTags = (existing.tags || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        const merged = Array.from(new Set([...baseTags, ...currentTags]));
        tagsString = merged.join(', ');
    }

    // 3) Images
    let images = undefined;
    if (replace_images === true) {
        const imgs = [];
        if (gram.image_url) imgs.push({ src: gram.image_url });
        if (Array.isArray(extra_images)) {
            for (const src of extra_images) imgs.push({ src });
        }
        images = imgs;
    } else if (Array.isArray(extra_images)) {
        // If not replacing, we can append by re-sending combined (Shopify REST images has quirks),
        // safest predictable behavior is "replace" — so we only do this when explicitly asked.
        const imgs = [];
        if (gram.image_url) imgs.push({ src: gram.image_url });
        for (const img of existing.images || []) {
            if (img?.src) imgs.push({ src: img.src });
        }
        for (const src of extra_images) imgs.push({ src });
        images = imgs;
    }

    // 4) Variant price update
    const targetVariantId =
        variant_id ||
        (existing.variants && existing.variants[0] && existing.variants[0].id) ||
        null;

    const variants =
        price != null && targetVariantId
            ? [{ id: targetVariantId, price: String(price) }]
            : undefined;

    // 5) Build update payload (only set fields you intend)
    const updateUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/products/${product_id}.json`;

    const payload = {
        product: {
            id: product_id,

            title: gram.title ?? existing.title,
            body_html: gram.description ?? existing.body_html,

            status: status ?? existing.status,
            vendor: vendor ?? existing.vendor,
            product_type: product_type ?? existing.product_type,

            tags: tagsString,

            metafields_global_title_tag: seo_title ?? existing.metafields_global_title_tag,
            metafields_global_description_tag:
                seo_description ?? existing.metafields_global_description_tag,

            ...(images ? { images } : {}),
            ...(variants ? { variants } : {}),
        },
    };

    const res = await axios.put(updateUrl, payload, {
        headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
            'Content-Type': 'application/json',
        },
    });

    return { product: res.data.product };
}
// metafield upsert helper
async function upsertMetafieldsForProduct(product_id, metafields = []) {
    if (!product_id) throw new Error("product_id required");

    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/metafields.json`;

    const results = [];
    for (const mf of metafields) {
        const payload = {
            metafield: {
                owner_id: product_id,
                owner_resource: "product",
                namespace: mf.namespace,
                key: mf.key,
                type: mf.type,      // e.g. "single_line_text_field", "json", "number_integer"
                value: mf.value
            }
        };

        const res = await axios.post(url, payload, {
            headers: {
                "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
                "Content-Type": "application/json"
            }
        });

        results.push(res.data.metafield);
    }

    return results;
}

async function syncGramMetafieldsToShopify(gram) {
    if (!gram?.shopify_product_id) {
        throw new Error("Gram has no shopify_product_id");
    }

    const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

    const metafields = [
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "gram_id",
            type: "single_line_text_field",
            value: String(gram.id || "")
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "slug",
            type: "single_line_text_field",
            value: String(gram.slug || "")
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "nfc_tag_id",
            type: "single_line_text_field",
            value: String(gram.nfc_tag_id || "")
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "effects",
            type: "json",
            value: JSON.stringify(gram.effects || {})
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "perks",
            type: "json",
            value: JSON.stringify(Array.isArray(gram.perks) ? gram.perks : [])
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "series",
            type: "single_line_text_field",
            value: gram.series || "collection-1"
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "rarity",
            type: "single_line_text_field",
            value: gram.rarity || "standard"
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "glow",
            type: "boolean",
            value: Boolean(gram.effects?.glow)
        },
        {
            ownerId: `gid://shopify/Product/${gram.shopify_product_id}`,
            namespace: "gram",
            key: "frame",
            type: "single_line_text_field",
            value: gram.effects?.frame || "none"
        }

    ];

    const res = await axios.post(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/graphql.json`,
        {
            query: mutation,
            variables: { metafields }
        },
        {
            headers: {
                "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
                "Content-Type": "application/json"
            }
        }
    );
    // ✅ 1) Catch GraphQL top-level errors
    if (res.data?.errors?.length) {
        throw new Error("GraphQL errors: " + JSON.stringify(res.data.errors));
    }

    const result = res.data?.data?.metafieldsSet;

    // ✅ 2) Catch missing result (also a failure)
    if (!result) {
        throw new Error("No metafieldsSet result: " + JSON.stringify(res.data));
    }

    // ✅ 3) Catch Shopify userErrors
    if (result.userErrors?.length) {
        throw new Error("metafieldsSet userErrors: " + JSON.stringify(result.userErrors));
    }

    return result.metafields || [];
}

async function shopifyGraphql(query, variables = {}) {
    const res = await shopifyHttp.post(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/graphql.json`,
        { query, variables }
    );

    if (res.data?.errors?.length) {
        throw new Error("GraphQL errors: " + JSON.stringify(res.data.errors));
    }
    return res.data.data;
}

async function createBasicDiscountCode({
    code,
    title,
    kind = "percent", // "percent" | "fixed"
    value,
    usageLimit = 1,
    startsAt = new Date().toISOString(),
    endsAt = null,
    appliesOncePerCustomer = false,
}) {
    const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `;

    const customerGetsValue =
        kind === "percent"
            ? { percentage: Number(value) / 100 }
            : { fixedAmount: { amount: String(value), appliesOnEachItem: false } };

    const input = {
        title,
        code,
        startsAt,
        ...(endsAt ? { endsAt } : {}),
        usageLimit: Number(usageLimit),
        customerSelection: { all: true },

        // ✅ Basic discount only needs customerGets
        customerGets: {
            items: { all: true }, // applies to entire order
            value: customerGetsValue,
        },

        appliesOncePerCustomer: !!appliesOncePerCustomer,
    };

    const data = await shopifyGraphql(mutation, { basicCodeDiscount: input });
    const out = data.discountCodeBasicCreate;

    if (out.userErrors?.length) throw new Error(JSON.stringify(out.userErrors));
    return out.codeDiscountNode.id;
}

async function createBxgyFreeProductCode({
    code,
    title,
    variantIdNumeric,
    quantity = 1,
    usageLimit = 1,
    startsAt = new Date().toISOString(),
    endsAt = null,
}) {
    const mutation = `
    mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
      discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `;

    const variantGid = `gid://shopify/ProductVariant/${variantIdNumeric}`;

    const input = {
        title,
        code,
        startsAt,
        ...(endsAt ? { endsAt } : {}),
        usageLimit: Number(usageLimit),
        customerSelection: { all: true },

        customerBuys: {
            items: { all: true }, // simplest: any purchase qualifies (you can tighten later)
            value: { quantity: 1 },
        },

        customerGets: {
            items: { products: { productVariantsToAdd: [variantGid] } },
            value: { percentage: 100 },
            quantity: Number(quantity),
        },

        appliesOncePerCustomer: false,
    };

    const data = await shopifyGraphql(mutation, { bxgyCodeDiscount: input });
    const out = data.discountCodeBxgyCreate;

    if (out.userErrors?.length) throw new Error(JSON.stringify(out.userErrors));
    return out.codeDiscountNode.id;
}



// 👈 THIS IS CRUCIAL: export BOTH functions as properties
module.exports = {
    listProducts,
    createProductForGram,
    updateProductForGram,
    syncGramMetafieldsToShopify,
    createBasicDiscountCode,
    createBxgyFreeProductCode,
};
