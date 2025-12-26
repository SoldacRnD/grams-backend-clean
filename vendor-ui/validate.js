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
    const I18N = {
        en: {
            title: "Validate Gram",
            subtitle: "Tap the physical Gram to this phone to validate perks.",
            save: "Save",
            validate: "Validate",
            approving: "Approving…",
            validating: "Validating…",
            ready: "Ready.",
            approve: "Approve",
            cooldown: "On cooldown",
            noPerks: "No perks for this vendor",
            noPerksDesc: "This Gram has no redeemable perks for your business."
        },
        pt: {
            title: "Validar Gram",
            subtitle: "Encosta a Gram física ao telemóvel para validar perks.",
            save: "Guardar",
            validate: "Validar",
            approving: "A aprovar…",
            validating: "A validar…",
            ready: "Pronto.",
            approve: "Aprovar",
            cooldown: "Em cooldown",
            noPerks: "Sem perks para este parceiro",
            noPerksDesc: "Esta Gram não tem perks resgatáveis para o teu negócio."
        }
    };

    function getLang() { return localStorage.getItem("vendor_lang") || "en"; }
    function setLang(lang) { localStorage.setItem("vendor_lang", lang); applyLang(); }
    function t(key) {
        const lang = getLang();
        return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    }

    function applyLang() {
        const h1 = document.querySelector("h1");
        if (h1) h1.textContent = t("title");
        const p = document.querySelector("header.top p.muted");
        if (p) p.textContent = t("subtitle");

        document.getElementById("saveAuth")?.textContent && (document.getElementById("saveAuth").textContent = t("save"));
        document.getElementById("load")?.textContent && (document.getElementById("load").textContent = t("validate"));
    }

    document.getElementById("langEN")?.addEventListener("click", () => setLang("en"));
    document.getElementById("langPT")?.addEventListener("click", () => setLang("pt"));
    applyLang();

  function qs(key) {
    const p = new URLSearchParams(location.search);
    return p.get(key);
  }

  function setStatus(s) { statusEl.textContent = s || ""; }

    function loadSaved() {
        businessIdEl.value = localStorage.getItem("vendor_business_id") || "";
        vendorSecretEl.value = localStorage.getItem("vendor_secret") || "";

        // Accept both ?tag= and ?nfcTagId=
        nfcTagIdEl.value = qs("nfcTagId") || qs("tag") || "";

        // Accept ?business_id=
        const bidFromUrl = (qs("business_id") || "").trim();
        if (bidFromUrl) {
            businessIdEl.value = bidFromUrl;
            localStorage.setItem("vendor_business_id", bidFromUrl);
        }

    }
    

    saveAuthBtn.onclick = async () => {
        const bid = (businessIdEl.value || "").trim();
        const sec = (vendorSecretEl.value || "").trim();
        if (!bid) return alert("Business ID required");
        if (!sec) return alert("Vendor Key required");

        localStorage.setItem("vendor_business_id", bid);
        localStorage.setItem("vendor_secret", sec);

        // ✅ NEW: set vendor session cookie on backend so /t/:tag can detect vendor device
        try {
            const r = await fetch(`/api/vendor/session`, {
                method: "POST",
                headers: {
                    "X-Business-Id": bid,
                    "X-Vendor-Secret": sec
                },
                credentials: "include"
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.ok) {
                console.warn("vendor session failed", r.status, j);
                alert("Vendor session cookie NOT set. Check Business ID / Vendor Key.");
            } else {
                // optional confirmation
                const s = await fetch(`/api/vendor/session/status`, { credentials: "include" }).then(x => x.json()).catch(() => ({}));
                console.log("session status", s);
            }
        } catch (e) { console.warn("vendor session error", e); }

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
          <h2>${t("noPerks")}</h2>
          <p class="muted">${t("noPerksDesc")}</p>
        </div>
      </div>
    `;
            return;
        }

        resultEl.innerHTML = `
    <div class="card">
      <div class="form">

        <div class="counter-instruction">
          <strong>🧾 Counter check</strong>
          <p id="counterInstruction"></p>
        </div>

        <div style="display:flex; gap:12px; align-items:center;">
          <img
            src="${g.image_url}"
            style="width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid #eee;"
            alt="${g.title || "Gram"}"
          />
          <div>
            <h2 style="margin:0;">${g.title || "Gram"}</h2>
            <div class="muted">Gram: ${g.id}</div>
          </div>
        </div>

        <div style="margin-top:12px;">
          ${perks.map(p => {
            const state = p.state;
            const disabled = state !== "available";
            const label = state === "available"
                ? t("approve")
                : `${t("cooldown")} (${msToHuman(p.cooldown_remaining_ms)})`;

            return `
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin:10px 0;">
                <div>
                  <strong>${p.business_name || p.business_id}</strong>

                  <div class="muted" style="margin-top:4px;">
                    ${p.type}
                    ${p.type === "free_item" && p.metadata?.item_name ? ` • item: ${p.metadata.item_name}` : ""}
                    ${p.type === "discount" && (p.metadata?.discount_percent != null) ? ` • ${p.metadata.discount_percent}%` : ""}
                    ${p.type === "access" && p.metadata?.access_label ? ` • ${p.metadata.access_label}` : ""}
                  </div>

                  ${p.cooldown_seconds ? `<div class="muted">Cooldown: ${p.cooldown_seconds}s</div>` : ``}
                </div>

                <div style="text-align:right;">
                  <button
                    class="btn primary"
                    data-approve="${p.id}"
                    ${disabled ? "disabled" : ""}
                    title="${disabled ? "This perk is not currently available." : "Approve redemption"}"
                  >
                    ${label}
                  </button>
                </div>
              </div>
            `;
        }).join("")}
        </div>

      </div>
    </div>
  `;

        // ✅ A1: Set instruction text AFTER HTML exists
        const COUNTER_COPY = {
            en: "Ask the customer to show the physical Gram. Confirm the image matches before approving.",
            pt: "Peça ao cliente para mostrar a Gram física. Confirme se a imagem corresponde antes de aprovar."
        };

        const el = document.getElementById("counterInstruction");
        if (el) el.textContent = COUNTER_COPY[getLang()] || COUNTER_COPY.en;

        // Approve handlers
        resultEl.querySelectorAll("button[data-approve]").forEach(btn => {
            btn.onclick = async () => {
                const perk_id = btn.getAttribute("data-approve");
                const nfcTagId = (nfcTagIdEl.value || "").trim();
                setStatus(t("approving"));

                const out = await apiPost(`${API_BASE}/api/vendor/validate/approve`, { nfcTagId, perk_id });

                if (!out.ok || !out.data?.ok) {
                    setStatus(`Failed: ${out.data?.error || "UNKNOWN"}`);
                    alert(out.data?.error || "Approve failed");
                    return;
                }

                // (Optional polish) show instant success before reload
                btn.textContent = "Approved ✓";
                btn.disabled = true;

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
