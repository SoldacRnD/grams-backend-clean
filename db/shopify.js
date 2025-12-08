// db/shopify.js
const axios = require('axios');

const SHOPIFY_STORE_DOMAIN =
    process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN; // e.g. soldacstudio.myshopify.com

// Re-use the same token you already use for GraphQL uploads
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

// Use same version as GraphQL
const SHOPIFY_ADMIN_VERSION = '2025-01';

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    console.warn('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN env vars');
}

/**
 * List Shopify products via REST Admin API.
 */
async function listProducts({ search = '', limit = 50 } = {}) {
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/products.json`;

    const params = {
        limit: Math.min(limit, 250), // Shopify max per page
        fields: 'id,title,handle,images,variants,status',
        // optional: only active products
        // status: 'active',
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

module.exports = { listProducts };