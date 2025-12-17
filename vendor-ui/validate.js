(function () {
  const $ = (id) => document.getElementById(id);
  const businessIdEl = $("businessId");
  const vendorSecretEl = $("vendorSecret");
  const saveAuthBtn = $("saveAuth");
  const nfcTagIdEl = $("nfcTagId");
  const loadBtn = $("load");
  const statusEl = $("status");
  const resultEl = $("result");

  const API_BASE = "";

  function qs(key) {
    const p = new URLSearchParams(location.search);
    return p.get(key);
  }

  function setStatus(s) { statusEl.textContent = s || ""; }

  function loadSaved() {
    businessIdEl.value = localStorage.getItem("vendor_business_id") || "";
    vendorSecretEl.value = localStorage.getItem("vendor_secret") || "";
    nfcTagIdEl.value = qs("nfcTagId") || qs("tag") || "";
    }
    if (!(nfcTagIdEl.value || "").trim()) {
        setStatus("Ready. Tap a Gram NFC tag or paste an nfcTagId.");
    }
    function getParam(name) {
        const u = new URL(window.location.href);
        return u.searchParams.get(name);
    }

    const bidFromUrl = (getParam("business_id") || "").trim();
    if (bidFromUrl && businessIdEl) {
        businessIdEl.value = bidFromUrl;
        localStorage.setItem("vendor_business_id", bidFromUrl);
    }
    if (bidFromUrl && vendorSecretEl) vendorSecretEl.focus();

  saveAuthBtn.onclick = () => {
    const bid = (businessIdEl.value || "").trim();
    const sec = (vendorSecretEl.value || "").trim();
    if (!bid) return alert("Business ID required");
    if (!sec) return alert("Vendor Key required");
    localStorage.setItem("vendor_business_id", bid);
    localStorage.setItem("vendor_secret", sec);
      setStatus("Saved.");
      showSoldacLinksIfNeeded();

  };

  async function apiGet(url) {
    const bid = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
    const sec = (vendorSecretEl.value || localStorage.getItem("vendor_secret") || "").trim();
    const res = await fetch(url, {
      headers: {
        "X-Business-Id": bid,
        "X-Vendor-Secret": sec,
      }
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    return { ok: res.ok, status: res.status, data, raw: text };
  }

  async function apiPost(url, body) {
    const bid = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
    const sec = (vendorSecretEl.value || localStorage.getItem("vendor_secret") || "").trim();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Business-Id": bid,
        "X-Vendor-Secret": sec,
      },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    return { ok: res.ok, status: res.status, data, raw: text };
  }
    function showSoldacLinksIfNeeded() {
        const bid = (localStorage.getItem("vendor_business_id") || "").trim();
        const el = document.getElementById("soldacLinks");
        if (!el) return;
        el.style.display = (bid === "SOLDAC") ? "flex" : "none";
    }


  function msToHuman(ms) {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${r}s`;
    return `${r}s`;
  }

  function renderValidated(payload) {
    const g = payload.gram;
    const perks = payload.perks || [];

    if (!perks.length) {
      resultEl.innerHTML = `
        <div class="card">
          <div class="form">
            <h2>No perks for this vendor</h2>
            <p class="muted">This Gram has no redeemable perks for your business.</p>
          </div>
        </div>
      `;
      return;
    }

    resultEl.innerHTML = `
      <div class="card">
        <div class="form">
          <div style="display:flex; gap:12px; align-items:center;">
            <img src="${g.image_url}" style="width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid #eee;" />
            <div>
              <h2 style="margin:0;">${g.title}</h2>
              <div class="muted">Gram: ${g.id}</div>
            </div>
          </div>

          <div style="margin-top:12px;">
            ${perks.map(p => {
              const state = p.state;
              const disabled = state !== "available";
              const label = state === "available"
                ? "Approve"
                : `On cooldown (${msToHuman(p.cooldown_remaining_ms)})`;

              return `
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                <div>
                   <strong>${p.business_name || p.business_id}</strong>
                   <div class="muted" style="margin-top:4px;">${p.type}</div>
                </div>
                 <div class="muted" style="text-align:right;">
                 ${p.cooldown_seconds ? `Cooldown: ${p.cooldown_seconds}s` : ""}
                 </div>
               </div>

              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;

    resultEl.querySelectorAll("button[data-approve]").forEach(btn => {
      btn.onclick = async () => {
        const perk_id = btn.getAttribute("data-approve");
        const nfcTagId = (nfcTagIdEl.value || "").trim();
        setStatus("Approving…");
        const out = await apiPost(`${API_BASE}/api/vendor/validate/approve`, { nfcTagId, perk_id });

        if (!out.ok || !out.data?.ok) {
          setStatus(`Failed: ${out.data?.error || "UNKNOWN"}`);
          alert(out.data?.error || "Approve failed");
          return;
        }
        setStatus("Approved ✅ Reloading status…");
        await load();
      };
    });
  }

  async function load() {
    const nfcTagId = (nfcTagIdEl.value || "").trim();
    if (!nfcTagId) return alert("Missing nfcTagId");
    setStatus("Validating…");
    const out = await apiGet(`${API_BASE}/api/vendor/validate?nfcTagId=${encodeURIComponent(nfcTagId)}`);

    if (!out.ok || !out.data?.ok) {
      setStatus(`Failed: ${out.data?.error || "UNKNOWN"} (HTTP ${out.status})`);
      resultEl.innerHTML = "";
      return;
    }
    setStatus("Ready.");
    renderValidated(out.data);
  }

  loadBtn.onclick = load;
    loadSaved();
    showSoldacLinksIfNeeded();

  // Auto-load if tag present in URL
  if ((nfcTagIdEl.value || "").trim()) load();
})();
