// db/shopify.js
const axios = require('axios');

const SHOPIFY_STORE_DOMAIN =
    process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN; // e.g. soldacstudio.myshopify.com

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;           // same token you use for GraphQL
const SHOPIFY_ADMIN_VERSION = '2025-01';

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    console.warn('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars');
}

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

// 👈 THIS IS CRUCIAL: export BOTH functions as properties
module.exports = {
    listProducts,
    createProductForGram,
};
