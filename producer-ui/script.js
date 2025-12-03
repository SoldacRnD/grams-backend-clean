const SHOP_DOMAIN = 'https://www.soldacstudio.com';   // adjust if needed
const BACKEND_BASE = window.location.origin;

let currentPerks = [];
let lastUploaded = [];  // { originalName, shopifyId?, url, status? }

function slugify(input) {
    return input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function prettyTitleFromFilename(name) {
    // Remove extension and turn dashes/underscores into spaces
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

    if (currentPerks.length === 0) {
        list.innerHTML = "<p>No perks added.</p>";
        return;
    }

    list.innerHTML = currentPerks.map(p => {
        return `<div class="perk-item">
      ${p.business_name || p.business_id} – ${p.type}
      ${p.metadata && p.metadata.discount_percent ? ` (${p.metadata.discount_percent}% off)` : ""}
      [cooldown: ${p.cooldown_seconds}s]
    </div>`;
    }).join("");
}

function renderUploaded() {
    const container = document.getElementById("uploaded-list");
    if (!container) return;

    if (!lastUploaded.length) {
        container.innerHTML = "<p>No images uploaded yet.</p>";
        return;
    }

    container.innerHTML = lastUploaded.map((f, idx) => {
        return `<div class="uploaded-item" data-idx="${idx}">
      <strong>${f.originalName}</strong>
      <span>${f.url}</span>
      <em>Click to use this image</em>
    </div>`;
    }).join("");

    container.querySelectorAll(".uploaded-item").forEach(el => {
        el.onclick = async () => {
            const idx = parseInt(el.getAttribute("data-idx"), 10);
            const f = lastUploaded[idx];

            const imageInput = document.getElementById("image");
            const titleInput = document.getElementById("title");
            const idInput = document.getElementById("id");

            if (imageInput) imageInput.value = f.url;

            // Suggest a title if empty
            if (titleInput && !titleInput.value) {
                titleInput.value = prettyTitleFromFilename(f.originalName);
            }

            // Auto-fill ID if empty
            if (idInput && !idInput.value) {
                const nextId = await fetchNextId();
                if (nextId) idInput.value = nextId;
            }
        };
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Producer UI loaded, backend base =', BACKEND_BASE);

    const uploadBtn = document.getElementById("upload-files");
    const fileInput = document.getElementById("file-input");
    const addPerkBtn = document.getElementById("add-perk");
    const generateBtn = document.getElementById("generate");
    const saveBtn = document.getElementById("save");
    const copyBtn = document.getElementById("copy");

    // Handle image upload to Shopify (via new GraphQL-based backend route)
    if (uploadBtn && fileInput) {
        uploadBtn.onclick = async () => {
            const files = fileInput.files;
            if (!files || !files.length) {
                alert("Select at least one image file first");
                return;
            }

            const formData = new FormData();
            Array.from(files).forEach(f => {
                formData.append('files', f);
            });

            try {
                const res = await fetch(`${BACKEND_BASE}/api/producer/upload-images`, {
                    method: 'POST',
                    body: formData
                });

                const data = await res.json().catch(() => ({}));
                console.log('Upload response:', res.status, data);

                if (!res.ok || !data.files) {
                    alert('Failed to upload images: ' + (data.error || res.status));
                    return;
                }

                lastUploaded = data.files;
                renderUploaded();
                alert('Uploaded to Shopify. Click an item below to use its image URL.');
            } catch (err) {
                console.error('Upload error:', err);
                alert('Error uploading images to backend.');
            }
        };
    }

    // Handle adding perks
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

    // Generate Gram JSON and URLs
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

            // Auto-generate ID if missing
            if (!id) {
                const nextId = await fetchNextId();
                if (nextId) {
                    id = nextId;
                    idInput.value = nextId;
                } else {
                    alert("Could not fetch next ID from backend");
                    return;
                }
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

    // Save Gram to backend (Supabase via /api/producer/grams)
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

    // Initial renders
    renderPerks();
    renderUploaded();
});
