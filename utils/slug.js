// utils/slug.js
function slugify(input) {
    return String(input)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric -> -
        .replace(/^-+|-+$/g, '');      // trim leading/trailing -
}

module.exports = slugify;
