(function () {
  const $ = (id) => document.getElementById(id);

  const businessIdEl = $("businessId");
  const gramIdEl = $("gramId");
  const saveBusinessBtn = $("saveBusinessId");
  const loadBtn = $("loadPerks");
  const refreshBtn = $("refresh");
  const statusEl = $("status");
  const tbody = $("perksTbody");
  const debugEl = $("debug");

  // Same-origin by default (works on Render + local)
  const API_BASE = "";

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function pretty(obj) {
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
  }

  function loadSaved() {
    const saved = localStorage.getItem("vendor_business_id") || "";
    businessIdEl.value = saved;
  }

  saveBusinessBtn.onclick = () => {
    const bid = (businessIdEl.value || "").trim();
    if (!bid) return alert("Business ID required");
    localStorage.setItem("vendor_business_id", bid);
    setStatus("Business ID saved.");
  };

  async function apiGet(url) {
    const res = await fetch(url);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    return { ok: res.ok, status: res.status, data, raw: text };
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    return { ok: res.ok, status: res.status, data, raw: text };
  }

  function perkDetails(p) {
    // Friendly view based on your live perk shapes
    if (p.type === "shopify_discount") {
      const kind = p.metadata?.kind || "percent";
      const value = p.metadata?.value;
      const title = p.metadata?.title || "";
      if (value != null) return `${title ? title + " — " : ""}${kind}:${value}`;
      return title || "(discount)";
    }
    if (p.type === "shopify_free_product") {
      const variant = p.metadata?.variant_id;
      const qty = p.metadata?.quantity ?? 1;
      return `variant:${variant || "?"} qty:${qty}`;
    }
    // Legacy types (if any still exist)
    if (p.type === "free_item") return p.metadata?.item_name ? `Free ${p.metadata.item_name}` : "(free item)";
    if (p.type === "discount") return p.metadata?.discount_percent ? `${p.metadata.discount_percent}% off` : "(discount)";
    return p.metadata ? pretty(p.metadata).slice(0, 140) : "";
  }

  function render(perks) {
    if (!perks.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No perks found for this vendor.</td></tr>`;
      return;
    }

    tbody.innerHTML = perks.map((p) => {
      const enabled = !!p.enabled;
      const pill = enabled
        ? `<span class="pill on">Enabled</span>`
        : `<span class="pill off">Disabled</span>`;

      const cooldown = Number(p.cooldown_seconds || 0);
      const cooldownTxt = cooldown ? `${cooldown}s` : "—";

      return `
        <tr data-row-id="${p.id}">
          <td><strong>${p.gram_id}</strong><div class="muted">${p.perk_id}</div></td>
          <td><strong>${p.business_name || "—"}</strong><div class="muted">${p.business_id}</div></td>
          <td>${p.type}</td>
          <td>${perkDetails(p)}</td>
          <td>${cooldownTxt}</td>
          <td>${pill}</td>
          <td>
            <div class="actions">
              ${enabled
                ? `<button class="btn small" data-action="disable" data-id="${p.id}">Disable</button>`
                : `<button class="btn small primary" data-action="enable" data-id="${p.id}">Enable</button>`
              }
              <button class="btn small" data-action="inspect" data-id="${p.id}">Inspect</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // bind actions
    tbody.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.onclick = async () => {
        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        const business_id = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
        if (!business_id) return alert("Business ID missing");

        if (action === "inspect") {
          const perk = perks.find(x => String(x.id) === String(id));
          debugEl.textContent = pretty(perk || {});
          return;
        }

        setStatus(`${action}...`);
        const url = `${API_BASE}/api/vendor/perks/${encodeURIComponent(id)}/${action}`;
        const out = await apiPost(url, { business_id });

        debugEl.textContent = `HTTP ${out.status}\n` + (out.raw || "");
        if (!out.ok || !out.data?.ok) {
          setStatus(`Failed: ${out.data?.error || "UNKNOWN"}`);
          alert(`Failed: ${out.data?.error || "UNKNOWN"}`);
          return;
        }

        setStatus("Updated. Refreshing list…");
        await loadPerks();
      };
    });
  }

  async function loadPerks() {
    const business_id = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
    const gram_id = (gramIdEl.value || "").trim();

    if (!business_id) return alert("Business ID required");

    const url =
      `${API_BASE}/api/vendor/perks?business_id=${encodeURIComponent(business_id)}`
      + (gram_id ? `&gram_id=${encodeURIComponent(gram_id)}` : "");

    setStatus("Loading perks…");
    const out = await apiGet(url);

    debugEl.textContent = `HTTP ${out.status}\n` + (out.raw || "");

    if (!out.ok || !out.data?.ok) {
      setStatus(`Failed: ${out.data?.error || "UNKNOWN"}`);
      return;
    }

    render(out.data.perks || []);
    setStatus(`Loaded ${out.data.perks?.length || 0} perks.`);
  }

  loadBtn.onclick = loadPerks;
  refreshBtn.onclick = loadPerks;

  loadSaved();
})();
