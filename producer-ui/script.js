function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

document.getElementById("generate").onclick = () => {
  const id       = document.getElementById("id").value.trim();
  const title    = document.getElementById("title").value.trim();
  const image    = document.getElementById("image").value.trim();
  const desc     = document.getElementById("desc").value.trim();
  const frame    = document.getElementById("frame").value;
  const glow     = document.getElementById("glow").checked;

  if (!id || !title || !image) {
    alert("ID, Title and Image URL are required");
    return;
  }

  const slug = slugify(title);
  const nfcTag = "TAG-" + id;

  const shareUrl = `https://www.soldacstudio.com/pages/gram?slug=${slug}`;
  const nfcUrl   = `https://www.soldacstudio.com/pages/gram?tag=${nfcTag}`;

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
    perks: []
  };

  document.getElementById("slug").value   = slug;
  document.getElementById("nfc").value    = nfcTag;
  document.getElementById("share").value  = shareUrl;
  document.getElementById("nfcurl").value = nfcUrl;
  document.getElementById("json").value   = JSON.stringify(gram, null, 2);
};

document.getElementById("copy").onclick = () => {
  const text = document.getElementById("json").value;
  navigator.clipboard.writeText(text);
  alert("JSON copied to clipboard");
};
