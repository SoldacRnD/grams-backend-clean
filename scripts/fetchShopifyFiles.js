// scripts/fetchShopifyFiles.js
require('dotenv').config();
const fetch = require('node-fetch');

const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_TOKEN;

// Search for this exact file
const TARGET = "GRAM_For-Print-on-CP1300-working-on-BOOMjpg_03_3_89a09c5e-4107-46f7-a372-e86871c6932a.jpg";

if (!shopDomain || !token) {
    console.error('Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_TOKEN');
    process.exit(1);
}

const endpoint = `https://${shopDomain}/admin/api/2024-01/graphql.json`;

const query = `
{
  files(first: 200) {
    edges {
      node {
        __typename
        ... on MediaImage {
          id
          alt
          image {
            url
          }
        }
      }
    }
  }
}
`;

(async () => {
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': token
            },
            body: JSON.stringify({ query })
        });

        const json = await res.json();
        const edges = json?.data?.files?.edges || [];

        let found = null;

        edges.forEach(e => {
            const node = e.node;
            const url = node?.image?.url || "";
            if (url.includes(TARGET)) {
                found = node;
            }
        });

        if (found) {
            console.log("FOUND FILE:");
            console.log(JSON.stringify(found, null, 2));
        } else {
            console.log("NOT FOUND in Files API");
        }

    } catch (err) {
        console.error('Shopify API error:', err);
    }
})();
