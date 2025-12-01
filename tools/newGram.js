// tools/newGram.js
// Usage:
//   node tools/newGram.js G002 "Another Cat" "https://cdn.shopify.com/...jpg"
//
// 1st arg: id        (G002, G003, ...)
// 2nd arg: title     ("Blue Sitting Cat #2")
// 3rd arg: image_url (from Shopify Files)

const slugify = require('../utils/slug');

const SHOP_DOMAIN = 'https://www.soldacstudio.com'; // adjust if needed

function main() {
    const [, , idArg, titleArg, imageUrlArg] = process.argv;

    if (!idArg || !titleArg || !imageUrlArg) {
        console.log('Usage: node tools/newGram.js <id> "<title>" "<image_url>"');
        process.exit(1);
    }

    const id = idArg;              // e.g. G002
    const title = titleArg;
    const image_url = imageUrlArg;

    const slug = slugify(title);   // "Blue Sitting Cat #2" -> "blue-sitting-cat-2"
    const nfc_tag_id = `TAG-${id}`;  // G002 -> TAG-G002

    const gram = {
        id,
        slug,
        nfc_tag_id,
        title,
        image_url,
        description: "",
        effects: {
            frame: "none",
            glow: false
        },
        owner_id: null,
        perks: []
    };

    const shareUrl = `${SHOP_DOMAIN}/pages/gram?slug=${encodeURIComponent(slug)}`;
    const nfcUrl = `${SHOP_DOMAIN}/pages/gram?tag=${encodeURIComponent(nfc_tag_id)}`;

    console.log('=== New Gram ===');
    console.log(JSON.stringify(gram, null, 2));
    console.log();
    console.log('Share URL:', shareUrl);
    console.log('NFC URL:  ', nfcUrl);
}

main();
