const SHOP_DOMAIN = 'https://www.soldacstudio.com';   // adjust if needed
const BACKEND_BASE = window.location.origin;

let currentPerks = [];
let lastUploaded = [];  // { originalName, shopifyId, url, status }
let currentImageIndex = -1;

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

    list.innerHTML = currentPerks.map(p => {
        const discount = p.metadata && p.metadata.discount_percent
            ? ` (${p.metadata.discount_percent}% off)`
            : "";
        return `<div class="perk-item">
      ${p.business_name || p.business_id} – ${p.type}${discount}
      <span class="cooldown">cooldown: ${p.cooldown_seconds || 0}s</span>
    </div>`;
    }).join("");
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
        return `<div class="uploaded-item ${selectedClass}" data-idx="${idx}">
      <strong>${f.originalName}</strong>
      <span class="url">${urlText}</span>
      <em>Click to use this image</em>
    </div>`;
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

            if (imageInput) {
                if (f.url) {
                    imageInput.value = f.url;
                } else {
                    imageInput.placeholder = "CDN URL not ready yet – re-upload later or paste from Shopify Files.";
                }
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

document.addEventListener('DOMContentLoaded', () => {
    console.log('Producer UI loaded, backend base =', BACKEND_BASE);

    const fileInput = document.getElementById("file-input");
    const uploadBtn = document.getElementById("upload-files");
    const addPerkBtn = document.getElementById("add-perk");
    const generateBtn = document.getElementById("generate");
    const saveBtn = document.getElementById("save");
    const copyBtn = document.getElementById("copy");
    const statusEl = document.getElementById("upload-status");

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

                lastUploaded = data.files;
                currentImageIndex = lastUploaded.length ? 0 : -1;
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

            currentPerks.push(perk);
            renderPerks();
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
            const image = imageInput.value.trim();
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

                alert('Gram saved to backend (Supabase) successfully.');
            } catch (err) {
                console.error('Save error:', err);
                alert('Error saving Gram to backend.');
            }
        };
    }

    renderPerks();
    renderUploaded();
});
