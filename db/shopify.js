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
async function createProductForGram(gram, { price, status = 'active' } = {}) {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
        throw new Error('Missing Shopify domain or admin token');
    }

    if (!gram || !gram.id) {
        throw new Error('Gram is required');
    }

    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/products.json`;

    const payload = {
        product: {
            title: gram.title || gram.id,
            body_html: gram.description || '',
            status, // 'active' or 'draft'
            handle: (gram.slug || gram.id).toLowerCase(),
            product_type: 'Gram',
            vendor: 'A Gram of Art',
            tags: [
                'gram-of-art',
                `gram-id:${gram.id}`,
            ],
            images: gram.image_url ? [{ src: gram.image_url }] : [],
            variants: [
                {
                    price: String(price),
                    sku: gram.id,
                    inventory_management: null, // no inventory tracking for now
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

    return {
        product_id: product.id,
        variant_id: firstVariant ? firstVariant.id : null,
        product,
    };
}

// 👈 THIS IS CRUCIAL: export BOTH functions as properties
module.exports = {
    listProducts,
    createProductForGram,
};
