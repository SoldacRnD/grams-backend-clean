const SHOP_DOMAIN = 'https://www.soldacstudio.com';   // adjust if needed
const BACKEND_BASE = window.location.origin;

let currentPerks = [];
let lastUploaded = [];  // { originalName, shopifyId, url, status }
let currentImageIndex = -1;
let existingGrams = [];          // 🔹 all grams from backend
let gramsPageSize = 12;          // 🔹 how many per page
let gramsCurrentPage = 1;        // 🔹 current page index (1-based)
let isEditingExistingGram = false; // Editing Existing Gram
let currentGramId = null; // for linked Shopify products
let extraProductImages = []; // { originalName, url, shopifyId, status }



function populateFormFromGram(gram) {
    if (!gram) return;
    // 🔗 track which Gram is active for products
    currentGramId = gram.id || null;
    // NEW: enter editing mode
    setEditingMode(gram);

    // Fill main form
    document.getElementById("id").value = gram.id || "";
    document.getElementById("title").value = gram.title || "";
    document.getElementById("image").value = gram.image_url || "";
    document.getElementById("desc").value = gram.description || "";

    const frameSelect = document.getElementById("frame");
    const glowCheckbox = document.getElementById("glow");
    if (frameSelect) {
        frameSelect.value = (gram.effects && gram.effects.frame) || "none";
    }
    if (glowCheckbox) {
        glowCheckbox.checked = !!(gram.effects && gram.effects.glow);
    }

    // Output fields
    document.getElementById("slug").value = gram.slug || "";
    document.getElementById("nfc").value = gram.nfc_tag_id || "";
    document.getElementById("share").value = gram.slug
        ? `${SHOP_DOMAIN}/pages/gram?slug=${gram.slug}`
        : "";
    document.getElementById("nfcurl").value = gram.nfc_tag_id
        ? `${SHOP_DOMAIN}/pages/gram?tag=${gram.nfc_tag_id}`
        : "";

    // Perks
    currentPerks = Array.isArray(gram.perks) ? gram.perks : [];
    renderPerks();

    // JSON preview (with owner preserved)
    const gramForJson = {
        id: gram.id,
        slug: gram.slug,
        nfc_tag_id: gram.nfc_tag_id,
        title: gram.title,
        image_url: gram.image_url,
        description: gram.description,
        effects: gram.effects || {},
        owner_id: gram.owner_id || null,
        perks: currentPerks
    };
    document.getElementById("json").value =
        JSON.stringify(gramForJson, null, 2);

    // 🔹 QR CODE: regenerate whenever we load a gram
    const qrContainer = document.getElementById("qrcode");
    if (qrContainer) {
        qrContainer.innerHTML = "";

        let url = "";
        if (gram.nfc_tag_id) {
            url = `${SHOP_DOMAIN}/pages/gram?tag=${gram.nfc_tag_id}`;
        } else if (gram.slug) {
            url = `${SHOP_DOMAIN}/pages/gram?slug=${gram.slug}`;
        }

        if (url) {
            new QRCode(qrContainer, {
                text: url,
                width: 128,
                height: 128
            });
        }
    }
    // 🔗 finally: load linked Shopify products for this Gram
    loadLinkedProducts();
}
function setEditingMode(gramOrNull) {
    const idInput = document.getElementById("id");
    const banner = document.getElementById("editing-banner");
    const editingId = document.getElementById("editing-id");

    if (gramOrNull && gramOrNull.id) {
        isEditingExistingGram = true;
        if (idInput) {
            idInput.disabled = true;
            idInput.classList.add("locked");
            idInput.value = gramOrNull.id;
        }
        if (banner && editingId) {
            banner.style.display = "flex";
            editingId.textContent = gramOrNull.id;
        }
    } else {
        isEditingExistingGram = false;
        if (idInput) {
            idInput.disabled = false;
            idInput.classList.remove("locked");
        }
        if (banner) {
            banner.style.display = "none";
        }
    }
}

function renderShopifyProductStatus(gram) {
    const box = document.getElementById("shopify-product-status");
    if (!box) return;

    if (!gram || !gram.shopify_product_id) {
        box.innerHTML = `
            <p>No Shopify product linked.</p>
        `;
        return;
    }

    const pid = gram.shopify_product_id;
    const vid = gram.shopify_variant_id || "(none)";

    box.innerHTML = `
        <p><strong>Shopify Product ID:</strong> ${pid}</p>
        <p><strong>Variant ID:</strong> ${vid}</p>
        <p>
          <a href="https://${SHOP_DOMAIN.replace('https://', '')}/admin/products/${pid}" target="_blank">
            Open in Shopify Admin
          </a>
        </p>
    `;
}

function syncUploadedSelectionForGram(gram) {
    if (!gram || !gram.image_url || !Array.isArray(lastUploaded) || !lastUploaded.length) {
        return;
    }

    let foundIndex = -1;
    lastUploaded.forEach((f, idx) => {
        if (f.url === gram.image_url) {
            f.saved = true;
            if (foundIndex === -1) foundIndex = idx;
        }
    });

    if (foundIndex !== -1) {
        currentImageIndex = foundIndex;
        renderUploaded();
    }
}

async function deleteGram(id) {
    if (!confirm(`Delete gram ${id}? This cannot be undone.`)) {
        return;
    }

    try {
        const res = await fetch(
            `${BACKEND_BASE}/api/producer/grams/` + encodeURIComponent(id),
            { method: 'DELETE' }
        );
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok) {
            alert('Failed to delete gram: ' + (data.error || res.status));
            return;
        }

        // Remove from local list
        existingGrams = existingGrams.filter(g => String(g.id) !== String(id));
        // If we deleted the last item on the page, move back one page if needed
        const maxPage = Math.max(1, Math.ceil(existingGrams.length / gramsPageSize));
        if (gramsCurrentPage > maxPage) gramsCurrentPage = maxPage;

        renderExistingGrams();

        // If the current form is showing this gram, clear ID (optional)
        const idInput = document.getElementById("id");
        if (idInput && idInput.value.trim() === String(id)) {
            idInput.value = "";
        }

        alert(`Gram ${id} deleted.`);
    } catch (e) {
        console.error('Error deleting gram:', e);
        alert('Error deleting gram.');
    }
}

async function duplicateGram(id) {
    const original = existingGrams.find(g => String(g.id) === String(id));
    if (!original) {
        alert('Original gram not found for duplication.');
        return;
    }

    try {
        // Get next ID from backend
        const resId = await fetch(`${BACKEND_BASE}/api/producer/next-id`);
        const idData = await resId.json().catch(() => ({}));
        const newId = idData.id;
        if (!resId.ok || !newId) {
            alert('Could not fetch next ID for duplicate.');
            return;
        }

        const baseSlug = original.slug || slugify(original.title || newId);
        const newSlug = `${baseSlug}-copy-${newId.toLowerCase()}`;
        const newNfcTag = `TAG-${newId}`;

        const newGram = {
            ...original,
            id: newId,
            slug: newSlug,
            nfc_tag_id: newNfcTag,
            owner_id: null  // duplicated gram has no owner
        };

        // Clean up fields Supabase might not like on insert
        delete newGram.created_at;
        delete newGram.updated_at;

        const resSave = await fetch(`${BACKEND_BASE}/api/producer/grams`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newGram)
        });
        const saveData = await resSave.json().catch(() => ({}));

        if (!resSave.ok || !saveData.ok || !saveData.gram) {
            console.error('Duplicate save error:', resSave.status, saveData);
            alert('Failed to duplicate gram.');
            return;
        }

        const saved = saveData.gram;

        // Add to local list & re-render
        existingGrams.push(saved);
        const maxPage = Math.max(1, Math.ceil(existingGrams.length / gramsPageSize));
        gramsCurrentPage = maxPage;  // jump to last page where new one likely is
        renderExistingGrams();

        // Populate form with the new duplicate for editing
        populateFormFromGram(saved);
        syncUploadedSelectionForGram(saved);

        alert(`Gram duplicated as ${saved.id}.`);
    } catch (e) {
        console.error('Error duplicating gram:', e);
        alert('Error duplicating gram.');
    }
}


function slugify(input) {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function prettyTitleFromFilename(name) {
    const base = name.replace(/\.[a-z0-9]+$/i, '');
    return base
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase());
}

async function fetchNextId() {
    try {
        const res = await fetch(`${BACKEND_BASE}/api/producer/next-id`);
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        return data.id || null;
    } catch (e) {
        console.error('Error fetching next ID:', e);
        return null;
    }
}
function renderExtraProductImages() {
    const container = document.getElementById("extra-product-images-preview");
    if (!container) return;

    if (!extraProductImages.length) {
        container.innerHTML = "<p>No extra product images uploaded.</p>";
        return;
    }

    container.innerHTML = extraProductImages
        .map(img => {
            const safeName = img.originalName || "(image)";
            const url = img.url || "";
            return `
        <div class="extra-image-item">
          ${url ? `<img src="${url}" alt="${safeName}" class="extra-image-thumb" />` : ""}
          <div class="extra-image-meta">
            <span>${safeName}</span>
            ${url ? `<span class="small-url">${url}</span>` : ""}
          </div>
        </div>
      `;
        })
        .join("");
}

function renderPerks() {
    const list = document.getElementById("perks-list");
    if (!list) return;

    if (!currentPerks.length) {
        list.innerHTML = "<p>No perks added.</p>";
        return;
    }

    list.innerHTML = currentPerks.map((p, idx) => {
        const discount = p.metadata && p.metadata.discount_percent
            ? ` (${p.metadata.discount_percent}% off)`
            : "";
        const item = p.type === 'free_item' && p.metadata && p.metadata.item_name
            ? ` – item: ${p.metadata.item_name}`
            : "";
        return `
      <div class="perk-item" data-idx="${idx}">
        <strong>${p.business_name || p.business_id}</strong>
        &nbsp;– ${p.type}${discount}${item}
        <span class="cooldown">cooldown: ${p.cooldown_seconds || 0}s</span>
        <button type="button" class="remove-perk">✕</button>
      </div>
    `;
    }).join("");

    // Wire up remove buttons
    list.querySelectorAll(".remove-perk").forEach(btn => {
        btn.onclick = () => {
            const parent = btn.closest('.perk-item');
            if (!parent) return;
            const idx = parseInt(parent.getAttribute('data-idx'), 10);
            if (!isNaN(idx)) {
                currentPerks.splice(idx, 1);
                renderPerks();
            }
        };
    });
}


function renderUploaded() {
    const container = document.getElementById("uploaded-list");
    const statusEl = document.getElementById("upload-status");
    if (!container) return;

    if (!lastUploaded.length) {
        container.innerHTML = "<p>No images uploaded yet.</p>";
        if (statusEl) statusEl.textContent = "";
        return;
    }

    container.innerHTML = lastUploaded.map((f, idx) => {
        const urlText = f.url || '(no URL yet)';
        const selectedClass = idx === currentImageIndex ? 'selected' : '';
        const imgHtml = f.url
            ? `<img src="${f.url}" alt="${f.originalName}" class="uploaded-thumb">`
            : '';
        const badge = f.saved ? '<span class="badge-saved">Saved</span>' : '';

        return `
      <div class="uploaded-item ${selectedClass}" data-idx="${idx}">
        ${imgHtml}
        <div class="uploaded-header">
          <strong>${f.originalName}</strong>
          ${badge}
        </div>
        <span class="url">${urlText}</span>
        <em>Click to use this image</em>
      </div>
    `;
    }).join("");


    container.querySelectorAll(".uploaded-item").forEach(el => {
        el.onclick = async () => {
            const idx = parseInt(el.getAttribute("data-idx"), 10);
            currentImageIndex = idx;
            const f = lastUploaded[idx];

            // re-render to update selected class
            renderUploaded();

            const imageInput = document.getElementById("image");
            const titleInput = document.getElementById("title");
            const idInput = document.getElementById("id");

            const finalUrl = f.url; // (or f.normalizedUrl || f.url if you added normalization)

            // 🔹 B.1: if this upload is already linked to a Gram (saved = true),
            // auto-load that Gram from backend.
            if (f.saved && finalUrl) {
                try {
                    const res = await fetch(
                        `${BACKEND_BASE}/api/producer/grams/by-image?imageUrl=` +
                        encodeURIComponent(finalUrl)
                    );
                    if (res.ok) {
                        const gram = await res.json();
                        populateFormFromGram(gram);
                        syncUploadedSelectionForGram(gram);
                        return; // done, no need to set up a new gram
                    }
                } catch (e) {
                    console.error('Error auto-loading gram by image:', e);
                    // fall through to "new gram" behavior
                }
            }
            // Default behavior for NEW grams (no existing backend record yet)
            if (!f.saved) {
                setEditingMode(null);
            }

            // Default behavior for NEW grams (no existing backend record yet)
            if (imageInput && finalUrl) {
                imageInput.value = finalUrl;
            } else if (!finalUrl) {
                imageInput.placeholder = "CDN URL not ready yet – re-upload later or paste from Shopify Files.";
            }

            if (titleInput && !titleInput.value) {
                titleInput.value = prettyTitleFromFilename(f.originalName);
            }

            if (idInput && !idInput.value) {
                const nextId = await fetchNextId();
                if (nextId) idInput.value = nextId;
            }
        };
    });


    if (statusEl) {
        statusEl.textContent = "Uploaded " + lastUploaded.length + " image(s). Click one to edit.";
    }
}
// Normalize Search IMG url
function normalizeImageUrl(url) {
    if (!url) return url;
    try {
        const u = new URL(url);
        u.search = ''; // drop ?v=...
        return u.toString();
    } catch (e) {
        // Fallback if URL constructor fails
        const idx = url.indexOf('?');
        return idx === -1 ? url : url.slice(0, idx);
    }
}

async function refreshSavedStatusForUploads() {
    for (const f of lastUploaded) {
        const candidateUrl = f.normalizedUrl || f.url;
        if (!candidateUrl) continue;
        try {
            const res = await fetch(
                `${BACKEND_BASE}/api/producer/grams/by-image?imageUrl=` +
                encodeURIComponent(candidateUrl)
            );
            if (res.ok) {
                f.saved = true;
            }
        } catch (e) {
            console.error('Error checking saved status for', candidateUrl, e);
        }
    }
}
// --------------------------------------
// Linked Shopify Products (Prod UI side)
// --------------------------------------

// Load existing linked products for the current Gram
async function loadLinkedProducts() {
    if (!currentGramId) return;

    try {
        // NOTE: adjust route prefix if you used /api/producer/...
        const res = await fetch(`${BACKEND_BASE}/api/producer/grams/${encodeURIComponent(currentGramId)}/products`);
        const json = await res.json();

        if (!json.ok) {
            console.error('Failed to load linked products', json);
            return;
        }

        renderLinkedProducts(json.links || []);
    } catch (err) {
        console.error('Error loading linked products', err);
    }
}

// Render the "currently linked" list
function renderLinkedProducts(links) {
    const list = document.getElementById('linked-products-list');
    if (!list) return;

    list.innerHTML = '';

    if (!links || !links.length) {
        list.innerHTML = '<li>No products linked yet.</li>';
        return;
    }

    for (const link of links) {
        const li = document.createElement('li');
        li.dataset.linkId = link.id;

        li.innerHTML = `
      <span>
        Product ID: ${link.shopify_product_id}
        ${link.shopify_variant_id ? ` (variant ${link.shopify_variant_id})` : ''}
      </span>
      <button type="button" class="unlink-product-btn">Remove</button>
    `;

        list.appendChild(li);
    }
}

// Call backend to search Shopify products by title
async function searchShopifyProducts(query) {
    const res = await fetch(
        `${BACKEND_BASE}/api/shopify/products?search=${encodeURIComponent(query)}`
    );
    const json = await res.json();
    if (!json.ok) {
        throw new Error(json.error || 'Search failed');
    }
    return json.products || [];
}

// Render Shopify search results (with "Link" buttons)
function renderShopifySearchResults(products) {
    const container = document.getElementById('shopify-product-search-results');
    if (!container) return;

    container.innerHTML = '';

    if (!products.length) {
        container.innerHTML = '<p>No products found for this search.</p>';
        return;
    }

    const list = document.createElement('ul');
    list.className = 'shopify-product-search-list';

    for (const product of products) {
        const li = document.createElement('li');
        li.className = 'shopify-product-search-item';

        const imageHtml = product.image
            ? `<img src="${product.image}" alt="${product.title}" class="product-thumb" />`
            : '';

        const variantsOptions = (product.variants || [])
            .map(
                (v) =>
                    `<option value="${v.id}">${v.title} – ${v.price}${v.sku ? ` (${v.sku})` : ''
                    }</option>`
            )
            .join('');

        const variantSelectHtml =
            (product.variants || []).length > 1
                ? `
        <label>
          Variant:
          <select class="variant-select" data-product-id="${product.id}">
            <option value="">Any / default</option>
            ${variantsOptions}
          </select>
        </label>
      `
                : '';

        li.innerHTML = `
      <div class="product-main">
        ${imageHtml}
        <div class="product-info">
          <div class="product-title">${product.title}</div>
          <div class="product-meta">
            <span>ID: ${product.id}</span>
            ${product.handle ? `<span>Handle: ${product.handle}</span>` : ''}
            <span>Status: ${product.status}</span>
          </div>
        </div>
      </div>
      <div class="product-actions">
        ${variantSelectHtml}
        <button
          type="button"
          class="link-product-btn"
          data-product-id="${product.id}"
        >
          Link to this Gram
        </button>
      </div>
    `;

        list.appendChild(li);
    }

    container.appendChild(list);
}

// Link selected product (and optional variant) to current Gram
async function linkProductToGram(shopify_product_id, shopify_variant_id = null) {
    if (!currentGramId) {
        alert('No Gram selected (load an existing Gram first).');
        return;
    }

    try {
        // NOTE: adjust route prefix if you used /api/producer/...
        const res = await fetch(
            `${BACKEND_BASE}/api/producer/grams/${encodeURIComponent(currentGramId)}/products`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shopify_product_id,
                    shopify_variant_id: shopify_variant_id || null,
                }),
            }
        );

        const json = await res.json();
        if (!json.ok) {
            console.error('Failed to link product', json);
            alert('Failed to link product. Check console for details.');
            return;
        }

        await loadLinkedProducts();
    } catch (err) {
        console.error('Error linking product', err);
        alert('Error linking product. Check console.');
    }
}

// Remove a link by its id
async function unlinkProduct(linkId) {
    if (!currentGramId) return;

    try {
        // NOTE: adjust route prefix if you used /api/producer/...
        const res = await fetch(
            `${BACKEND_BASE}/api/producer/grams/${encodeURIComponent(currentGramId)}/products/${encodeURIComponent(
                linkId
            )}`,
            {
                method: 'DELETE',
            }
        );

        const json = await res.json();
        if (!json.ok) {
            console.error('Failed to unlink product', json);
            alert('Failed to remove product link.');
            return;
        }

        await loadLinkedProducts();
    } catch (err) {
        console.error('Error unlinking product', err);
        alert('Error removing product link. Check console.');
    }
}

// Set up event listeners for search / link / unlink
function setupLinkedProductsUI() {
    const searchInput = document.getElementById('shopify-product-search');
    const searchBtn = document.getElementById('shopify-product-search-btn');

    if (!searchInput || !searchBtn) {
        console.warn('Linked products UI elements not found');
        return;
    }

    async function performSearch() {
        const query = (searchInput.value || '').trim();
        if (!query) {
            alert('Type something to search.');
            return;
        }

        try {
            const products = await searchShopifyProducts(query);
            renderShopifySearchResults(products);
        } catch (err) {
            console.error('Search error', err);
            alert('Error searching products. Check console.');
        }
    }

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performSearch();
        }
    });

    // Delegate clicks for "Link" and "Remove" buttons
    document.addEventListener('click', (e) => {
        const target = e.target;

        // Link product
        if (target.classList.contains('link-product-btn')) {
            const productId = target.getAttribute('data-product-id');
            if (!productId) return;

            const container = target.closest('.product-actions');
            let variantId = null;
            if (container) {
                const select = container.querySelector('.variant-select');
                if (select && select.value) {
                    variantId = select.value;
                }
            }

            linkProductToGram(productId, variantId);
        }

        // Unlink product
        if (target.classList.contains('unlink-product-btn')) {
            const li = target.closest('li[data-link-id]');
            const linkId = li?.dataset.linkId;
            if (!linkId) return;

            unlinkProduct(linkId);
        }
    });
}

// 🔹 NEW: global scope
function renderExistingGrams() {
    const container = document.getElementById("existing-grams");
    if (!container) return;

    if (!existingGrams.length) {
        container.innerHTML = "<p>No grams saved yet.</p>";
        // Clear pagination too
        const pag = document.getElementById("existing-grams-pagination");
        if (pag) pag.innerHTML = "";
        return;
    }

    const totalPages = Math.max(1, Math.ceil(existingGrams.length / gramsPageSize));
    if (gramsCurrentPage > totalPages) gramsCurrentPage = totalPages;

    const start = (gramsCurrentPage - 1) * gramsPageSize;
    const end = start + gramsPageSize;
    const pageItems = existingGrams.slice(start, end);

    container.innerHTML = pageItems.map(g => {
        const title = g.title || g.id || "(Untitled)";
        const thumb = g.image_url
            ? `<img src="${g.image_url}" alt="${title}" class="existing-thumb">`
            : "";
        const slugText = g.slug ? ` · ${g.slug}` : "";

        return `
      <div class="existing-gram-item" data-id="${g.id}">
        ${thumb}
        <div class="existing-meta">
          <strong>${title}</strong>
          <div class="existing-sub">ID: ${g.id}${slugText}</div>
          <div class="existing-actions">
            <button type="button" class="btn-small existing-load" data-id="${g.id}">Load</button>
            <button type="button" class="btn-small existing-duplicate" data-id="${g.id}">Duplicate</button>
            <button type="button" class="btn-small existing-delete" data-id="${g.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
    }).join("");

    // Click handlers
    container.querySelectorAll(".existing-load").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const gram = existingGrams.find(g => String(g.id) === String(id));
            if (gram) {
                populateFormFromGram(gram);
                syncUploadedSelectionForGram(gram);
            }
        };
    });

    container.querySelectorAll(".existing-duplicate").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            duplicateGram(id);
        };
    });

    container.querySelectorAll(".existing-delete").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            deleteGram(id);
        };
    });

    // Whole card click = load as well
    container.querySelectorAll(".existing-gram-item").forEach(card => {
        card.onclick = () => {
            const id = card.getAttribute("data-id");
            const gram = existingGrams.find(g => String(g.id) === String(id));
            if (gram) {
                populateFormFromGram(gram);
                syncUploadedSelectionForGram(gram);
            }
        };
    });

    renderExistingPagination(totalPages);
}

function renderExistingPagination(totalPages) {
    const pag = document.getElementById("existing-grams-pagination");
    if (!pag) return;

    if (totalPages <= 1) {
        pag.innerHTML = "";
        return;
    }

    pag.innerHTML = `
      <button type="button" class="btn-small" id="grams-prev" ${gramsCurrentPage === 1 ? 'disabled' : ''}>Prev</button>
      <span class="page-info">Page ${gramsCurrentPage} / ${totalPages}</span>
      <button type="button" class="btn-small" id="grams-next" ${gramsCurrentPage === totalPages ? 'disabled' : ''}>Next</button>
    `;

    const prevBtn = document.getElementById("grams-prev");
    const nextBtn = document.getElementById("grams-next");

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (gramsCurrentPage > 1) {
                gramsCurrentPage--;
                renderExistingGrams();
            }
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            if (gramsCurrentPage < totalPages) {
                gramsCurrentPage++;
                renderExistingGrams();
            }
        };
    }
}

async function loadExistingGrams() {
    try {
        const res = await fetch(`${BACKEND_BASE}/api/producer/grams`);
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.ok || !Array.isArray(data.grams)) {
            console.error('Failed to fetch existing grams:', res.status, data);
            return;
        }

        existingGrams = data.grams;
        gramsCurrentPage = 1;
        renderExistingGrams();
    } catch (e) {
        console.error('Error loading existing grams:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Producer UI loaded, backend base =', BACKEND_BASE);
    // 🔗 set up Shopify product search + link/unlink
    setupLinkedProductsUI();


    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-files");
    const extraProductFileInput = document.getElementById("extra-product-file-input");
    const uploadExtraProductBtn = document.getElementById("upload-extra-product-images");
    const addPerkBtn = document.getElementById("add-perk");
    const generateBtn = document.getElementById("generate");
    const saveBtn = document.getElementById("save");
    const copyBtn = document.getElementById("copy");
    const statusEl = document.getElementById("upload-status");
    const loadBtn = document.getElementById("load-gram");
    const clearEditBtn = document.getElementById("editing-clear");
    // Create Shopify Product Button
    const createShopProdBtn = document.getElementById("create-shopify-product-btn");
    if (createShopProdBtn) {
        createShopProdBtn.onclick = async () => {
            const gramId = document.getElementById("id").value.trim();
            const price = document.getElementById("shopify-product-price").value.trim();

            if (!gramId) {
                alert("Load or create a Gram first.");
                return;
            }

            if (!price || isNaN(Number(price))) {
                alert("Enter a valid numeric price.");
                return;
            }

            const statusSelect = document.getElementById("shopify-product-status-select");
            const status = statusSelect ? statusSelect.value : "active";

            const vendorInput = document.getElementById("shopify-product-vendor");
            const vendor = (vendorInput?.value.trim()) || "A Gram of Art";

            const typeInput = document.getElementById("shopify-product-type");
            const product_type = (typeInput?.value.trim()) || "Gram";

            const tagsInput = document.getElementById("shopify-product-tags");
            const extraTags = (tagsInput?.value || "")
                .split(",")
                .map(t => t.trim())
                .filter(Boolean);

            const seoTitleInput = document.getElementById("shopify-seo-title");
            const seo_descriptionInput = document.getElementById("shopify-seo-description");
            const seo_title = seoTitleInput?.value.trim() || null;
            const seo_description = seo_descriptionInput?.value.trim() || null;

            const extraImagesInput = document.getElementById("shopify-extra-images");
            const extra_images = (extraImagesInput?.value || "")
                .split(",")
                .map(u => u.trim())
                .filter(Boolean);

            const collectionsInput = document.getElementById("shopify-collection-ids");
            const collection_ids = (collectionsInput?.value || "")
                .split(",")
                .map(id => id.trim())
                .filter(Boolean); // keep as strings; backend can cast if needed

            try {
                const extra_images = extraProductImages
                    .map(img => img.url)
                    .filter(Boolean);

                const url = `${BACKEND_BASE}/api/producer/grams/${encodeURIComponent(gramId)}/shopify-product`;

                const payload = {
                    price,
                    status,
                    vendor,
                    product_type,
                    extra_tags: extraTags,
                    seo_title,
                    seo_description,
                    extra_images,
                    collection_ids,
                    replace_images: true
                };

                async function call(method) {
                    const res = await fetch(url, {
                        method,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json().catch(() => ({}));
                    return { res, data };
                }

                // 1️⃣ Always try CREATE first
                let { res, data } = await call("POST");
                let didUpdate = false;

                // 2️⃣ If product already exists → UPDATE instead
                if (!res.ok && data?.error === "PRODUCT_ALREADY_CREATED") {
                    ({ res, data } = await call("PUT"));
                    didUpdate = true;
                }

                // 3️⃣ Final failure check
                if (!res.ok || !data.ok) {
                    alert(
                        "Failed to sync Shopify product: " +
                        (data.error || res.status)
                    );
                    console.error("Shopify sync error:", data);
                    return;
                }

                // 4️⃣ Success
                alert(`Shopify product ${didUpdate ? "updated" : "created"} successfully ✅`);
                renderShopifyProductStatus(data.gram);
                updateShopifyButtonLabel(data.gram);


            } catch (err) {
                console.error("Error creating Shopify product:", err);
                alert("Error creating Shopify product");
            }
        };
    }

    if (clearEditBtn) {
        clearEditBtn.onclick = () => {
            // Exit editing mode
            setEditingMode(null);
            // 🔗 clear linked products state
            currentGramId = null;
            renderLinkedProducts([]); // if panel exists, show "No products linked yet."

            // Optional: clear form fields for a brand new gram
            document.getElementById("id").value = "";
            document.getElementById("title").value = "";
            document.getElementById("image").value = "";
            document.getElementById("desc").value = "";
            document.getElementById("slug").value = "";
            document.getElementById("nfc").value = "";
            document.getElementById("share").value = "";
            document.getElementById("nfcurl").value = "";
            document.getElementById("json").value = "";

            currentPerks = [];
            renderPerks();
        };
    }


    if (loadBtn) {
        loadBtn.onclick = async () => {
            const idVal = document.getElementById("load-id").value.trim();
            const slugVal = document.getElementById("load-slug").value.trim();

            if (!idVal && !slugVal) {
                alert("Enter an ID or a slug");
                return;
            }

            try {
                let gram;

                if (idVal) {
                    const res = await fetch(
                        `${BACKEND_BASE}/api/producer/grams/by-id/` +
                        encodeURIComponent(idVal)
                    );
                    if (!res.ok) {
                        alert("Gram not found by ID");
                        return;
                    }
                    gram = await res.json();
                } else {
                    const res = await fetch(
                        `${BACKEND_BASE}/api/grams/by-slug/` +
                        encodeURIComponent(slugVal)
                    );
                    if (!res.ok) {
                        alert("Gram not found by slug");
                        return;
                    }
                    gram = await res.json();
                }

                console.log('Loaded gram into Producer:', gram);

                // ✅ new helpers
                populateFormFromGram(gram);
                syncUploadedSelectionForGram(gram);
                renderShopifyProductStatus(gram);
                updateShopifyButtonLabel(gram);


            } catch (e) {
                console.error("Error loading gram:", e);
                alert("Error loading Gram");
            }
        };
    }
    function updateShopifyButtonLabel(gram) {
        const btn = document.getElementById("create-shopify-product-btn");
        if (!btn) return;

        btn.textContent = gram?.shopify_product_id
            ? "Update Shopify Product"
            : "Create Shopify Product from this Gram";
    }



    // Upload images to Shopify
    if (uploadBtn && fileInput) {
        uploadBtn.onclick = async () => {
            const files = fileInput.files;
            if (!files || !files.length) {
                alert("Select at least one image file first");
                return;
            }

            const formData = new FormData();
            Array.from(files).forEach(f => formData.append('files', f));

            if (statusEl) statusEl.textContent = "Uploading…";

            try {
                const res = await fetch(`${BACKEND_BASE}/api/producer/upload-images`, {
                    method: 'POST',
                    body: formData
                });

                const data = await res.json().catch(() => ({}));
                console.log('Upload response:', res.status, data);

                if (!res.ok || !data.ok || !Array.isArray(data.files)) {
                    alert('Failed to upload images: ' + (data.error || res.status));
                    if (statusEl) statusEl.textContent = "Upload failed.";
                    return;
                }

                // Initialize with saved: false
                lastUploaded = data.files.map(f => ({
                    ...f,
                    saved: false,
                    normalizedUrl: normalizeImageUrl(f.url)
                }));

                currentImageIndex = lastUploaded.length ? 0 : -1;

                // Check which ones already have grams in Supabase
                await refreshSavedStatusForUploads();
                
                renderUploaded();

                // Auto-select first image
                if (lastUploaded.length) {
                    const first = lastUploaded[0];
                    const imageInput = document.getElementById("image");
                    const titleInput = document.getElementById("title");
                    const idInput = document.getElementById("id");

                    if (imageInput && first.url) imageInput.value = first.url;
                    if (titleInput && !titleInput.value) {
                        titleInput.value = prettyTitleFromFilename(first.originalName);
                    }
                    if (idInput && !idInput.value) {
                        const nextId = await fetchNextId();
                        if (nextId) idInput.value = nextId;
                    }
                }


            } catch (err) {
                console.error('Upload error:', err);
                alert('Error uploading images to backend.');
                if (statusEl) statusEl.textContent = "Upload failed.";
            }
        };
    }

    // Upload Extra Product Media
    if (uploadExtraProductBtn && extraProductFileInput) {
        uploadExtraProductBtn.onclick = async () => {
            const files = extraProductFileInput.files;
            if (!files || !files.length) {
                alert("Select one or more image files for extra product images.");
                return;
            }

            const formData = new FormData();
            Array.from(files).forEach(f => formData.append("files", f));

            try {
                const res = await fetch(`${BACKEND_BASE}/api/producer/upload-images`, {
                    method: "POST",
                    body: formData,
                });

                const data = await res.json().catch(() => ({}));
                console.log("Extra images upload response:", res.status, data);

                if (!res.ok || !data.ok || !Array.isArray(data.files)) {
                    alert("Failed to upload extra images: " + (data.error || res.status));
                    return;
                }

                // Append to our extraProductImages list
                data.files.forEach(f => {
                    extraProductImages.push({
                        originalName: f.originalName,
                        url: f.url,
                        shopifyId: f.shopifyId,
                        status: f.status,
                    });
                });

                renderExtraProductImages();

                // Optional: clear file input
                extraProductFileInput.value = "";

            } catch (err) {
                console.error("Extra product images upload error:", err);
                alert("Error uploading extra product images.");
            }
        };
    }


    // Add perks
    if (addPerkBtn) {
        addPerkBtn.onclick = () => {
            const businessId = document.getElementById("perk-business-id").value.trim();
            const businessName = document.getElementById("perk-business-name").value.trim();
            const type = document.getElementById("perk-type").value;
            const discountStr = document.getElementById("perk-discount").value.trim();
            const itemStr = document.getElementById("perk-item").value.trim();
            const cooldownStr = document.getElementById("perk-cooldown").value.trim();

            if (!businessId) {
                alert("Business ID required for perk");
                return;
            }

            const perk = {
                id: "PERK-" + (currentPerks.length + 1),
                business_id: businessId,
                business_name: businessName || businessId,
                type,
                metadata: {},
                cooldown_seconds: cooldownStr ? parseInt(cooldownStr, 10) : 0
            };

            if (type === "discount" && discountStr) {
                perk.metadata.discount_percent = parseInt(discountStr, 10);
            }

            if (type === "free_item" && itemStr) {
                perk.metadata.item_name = itemStr;
            }

            currentPerks.push(perk);
            renderPerks();

            // Optional: clear perk form inputs after add
            document.getElementById("perk-business-id").value = "";
            document.getElementById("perk-business-name").value = "";
            document.getElementById("perk-discount").value = "";
            document.getElementById("perk-item").value = "";
            document.getElementById("perk-cooldown").value = "";
        };
    }


    // Generate Gram JSON & URLs
    if (generateBtn) {
        generateBtn.onclick = async () => {
            const idInput = document.getElementById("id");
            const titleInput = document.getElementById("title");
            const imageInput = document.getElementById("image");
            const descInput = document.getElementById("desc");
            const frameSelect = document.getElementById("frame");
            const glowCheckbox = document.getElementById("glow");

            let id = idInput.value.trim();
            const title = titleInput.value.trim();
            const rawImage = imageInput.value.trim();
            const image = normalizeImageUrl(rawImage);
            const desc = descInput.value.trim();
            const frame = frameSelect.value;
            const glow = glowCheckbox.checked;

            if (!title || !image) {
                alert("Title and Image URL are required");
                return;
            }

            if (!id) {
                const nextId = await fetchNextId();
                if (!nextId) {
                    alert("Could not fetch next ID from backend");
                    return;
                }
                id = nextId;
                idInput.value = nextId;
            }

            const slug = slugify(title);
            const nfcTag = "TAG-" + id;

            const shareUrl = `${SHOP_DOMAIN}/pages/gram?slug=${slug}`;
            const nfcUrl = `${SHOP_DOMAIN}/pages/gram?tag=${nfcTag}`;

            const gram = {
                id,
                slug,
                nfc_tag_id: nfcTag,
                title,
                image_url: image,
                description: desc,
                effects: {
                    frame,
                    glow
                },
                owner_id: null,
                perks: currentPerks
            };

            document.getElementById("slug").value = slug;
            document.getElementById("nfc").value = nfcTag;
            document.getElementById("share").value = shareUrl;
            document.getElementById("nfcurl").value = nfcUrl;
            document.getElementById("json").value = JSON.stringify(gram, null, 2);

            const qrContainer = document.getElementById("qrcode");
            qrContainer.innerHTML = "";
            new QRCode(qrContainer, {
                text: nfcUrl,
                width: 128,
                height: 128
            });
        };
    }

    // Copy JSON
    if (copyBtn) {
        copyBtn.onclick = () => {
            const text = document.getElementById("json").value;
            if (!text) {
                alert("Nothing to copy");
                return;
            }
            navigator.clipboard.writeText(text);
            alert("JSON copied to clipboard");
        };
    }

    // Save Gram to backend (Supabase)
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const jsonText = document.getElementById("json").value;
            if (!jsonText) {
                alert("Generate the Gram first");
                return;
            }

            let gram;
            try {
                gram = JSON.parse(jsonText);
            } catch (e) {
                alert("Invalid JSON, re-generate first");
                return;
            }

            try {
                const res = await fetch(`${BACKEND_BASE}/api/producer/grams`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(gram)
                });

                const data = await res.json().catch(() => ({}));
                console.log('Save response:', res.status, data);

                if (!res.ok || !data.ok) {
                    alert('Failed to save Gram to backend');
                    return;
                }
                
                // ✅ NEW: mark matching upload as saved
                if (gram.image_url && Array.isArray(lastUploaded) && lastUploaded.length) {
                    const gramNorm = normalizeImageUrl(gram.image_url);
                    for (const f of lastUploaded) {
                        const candidate = f.normalizedUrl || normalizeImageUrl(f.url);
                        if (candidate === gramNorm) {
                            f.saved = true;
                        }
                    }
                    renderUploaded();
                }

                alert('Gram saved to backend (Supabase) successfully.');
            } catch (err) {
                console.error('Save error:', err);
                alert('Error saving Gram to backend.');
            }
        };
    }
    // Load gallery of existing grams
    loadExistingGrams();

    renderPerks();
    renderUploaded();
});
