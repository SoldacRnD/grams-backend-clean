const SHOP_DOMAIN = 'https://www.soldacstudio.com';   // adjust if needed
const BACKEND_BASE = window.location.origin;

let currentPerks = [];
let lastUploaded = [];  // { originalName, shopifyId, url, status }
let currentImageIndex = -1;
let existingGrams = [];

function populateFormFromGram(gram) {
    if (!gram) return;

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
// 🔹 NEW: global scope
function renderExistingGrams() {
    const container = document.getElementById("existing-grams");
    if (!container) return;

    if (!existingGrams.length) {
        container.innerHTML = "<p>No grams saved yet.</p>";
        return;
    }

    container.innerHTML = existingGrams.map(g => {
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
        </div>
      </div>
    `;
    }).join("");

    container.querySelectorAll(".existing-gram-item").forEach(el => {
        el.onclick = () => {
            const id = el.getAttribute("data-id");
            const gram = existingGrams.find(g => String(g.id) === String(id));
            if (gram) {
                populateFormFromGram(gram);
                syncUploadedSelectionForGram(gram);
            }
        };
    });
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
        renderExistingGrams();
    } catch (e) {
        console.error('Error loading existing grams:', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Producer UI loaded, backend base =', BACKEND_BASE);

    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-files");
    const addPerkBtn = document.getElementById("add-perk");
    const generateBtn = document.getElementById("generate");
    const saveBtn = document.getElementById("save");
    const copyBtn = document.getElementById("copy");
    const statusEl = document.getElementById("upload-status");

    const loadBtn = document.getElementById("load-gram");

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

            } catch (e) {
                console.error("Error loading gram:", e);
                alert("Error loading Gram");
            }
        };
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
