// shopify.js
const axios = require('axios');

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // e.g. soldacstudio.myshopify.com
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_ADMIN_VERSION = '2025-07'; // ok for now, adjust when you update

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
  console.warn('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN env vars');
}

async function listProducts({ search = '', limit = 20 } = {}) {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_VERSION}/products.json`;

  const params = {
    limit,
    status: 'active',           // only active products for now
    fields: 'id,title,handle,images,variants,status'
  };

  // Very simple title filter – Shopify REST allows filtering by title in query.
  if (search) {
    params.title = search;
  }

  const res = await axios.get(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    params
  });

  return res.data.products || [];
}

module.exports = {
  listProducts,
};
