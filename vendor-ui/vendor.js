(function () {
  const $ = (id) => document.getElementById(id);

    const businessIdEl = $("businessId");
    const vendorSecretEl = document.getElementById("vendorSecret");

  const gramIdEl = $("gramId");
  const saveBusinessBtn = $("saveBusinessId");
  const loadBtn = $("loadPerks");
  const refreshBtn = $("refresh");
  const statusEl = $("status");
  const tbody = $("perksTbody");
  const debugEl = $("debug");

    const createGramIdEl = document.getElementById("createGramId");
    const createBusinessNameEl = document.getElementById("createBusinessName");
    const createTypeEl = document.getElementById("createType");
    const createCooldownEl = document.getElementById("createCooldown");
    const createFieldsEl = document.getElementById("createFields");
    const createBtn = document.getElementById("createPerk");
    const createPerkCardEl = document.getElementById("createPerkCard");



  // Same-origin by default (works on Render + local)
  const API_BASE = "";

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function pretty(obj) {
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
  }

    function loadSaved() {
        businessIdEl.value = localStorage.getItem("vendor_business_id") || "";
        if (vendorSecretEl) vendorSecretEl.value = localStorage.getItem("vendor_secret") || "";
    }


    saveBusinessBtn.onclick = () => {
        const bid = (businessIdEl.value || "").trim();
        const sec = (vendorSecretEl?.value || "").trim();

        if (!bid) return alert("Business ID required");
        if (!sec) return alert("Vendor Key required");

        localStorage.setItem("vendor_business_id", bid);
        localStorage.setItem("vendor_secret", sec);
        applyTypeLock(); // 👈 ADD THIS

        setStatus("Business ID + Vendor Key saved.");
        showSoldacLinksIfNeeded();

    };


    async function apiGet(url) {
        const bid = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
        const sec = (vendorSecretEl?.value || localStorage.getItem("vendor_secret") || "").trim();

        const res = await fetch(url, {
            headers: {
                "X-Business-Id": bid,
                "X-Vendor-Secret": sec,
            }
        });

        const text = await res.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_) { }
        return { ok: res.ok, status: res.status, data, raw: text };
    }


    async function apiPost(url, body) {
        const bid = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
        const sec = (vendorSecretEl?.value || localStorage.getItem("vendor_secret") || "").trim();

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
        try { data = text ? JSON.parse(text) : {}; } catch (_) { }
        return { ok: res.ok, status: res.status, data, raw: text };
    }
    function showSoldacLinksIfNeeded() {
        const bid = (localStorage.getItem("vendor_business_id") || "").trim();
        const el = document.getElementById("soldacLinks");
        if (!el) return;
        el.style.display = (bid === "SOLDAC") ? "flex" : "none";
    }


    function renderCreateFields() {
        const t = (createTypeEl.value || "").trim();

        // Partner in-person discount
        if (t === "discount") {
            createFieldsEl.innerHTML = `
      <div class="grid">
        <div>
          <label class="label">Discount %</label>
          <input id="metaDiscountPercent" class="input" type="number" placeholder="10" />
        </div>
        <div>
          <label class="label">Title (optional)</label>
          <input id="metaTitle" class="input" placeholder="10% off" />
        </div>
      </div>
    `;
            return;
        }

        // Partner in-person free item
        if (t === "free_item") {
            createFieldsEl.innerHTML = `
      <div class="grid">
        <div>
          <label class="label">Item name</label>
          <input id="metaItemName" class="input" placeholder="beer" />
        </div>
        <div>
          <label class="label">Title (optional)</label>
          <input id="metaTitle" class="input" placeholder="Free beer" />
        </div>
      </div>
    `;
            return;
        }

        // Partner access
        if (t === "access") {
            createFieldsEl.innerHTML = `
      <div class="grid">
        <div>
          <label class="label">Access label</label>
          <input id="metaAccessLabel" class="input" placeholder="VIP entry" />
        </div>
        <div>
          <label class="label">Title (optional)</label>
          <input id="metaTitle" class="input" placeholder="VIP access" />
        </div>
      </div>
    `;
            return;
        }

        // Soldac-only Shopify discount
        if (t === "shopify_discount") {
            createFieldsEl.innerHTML = `
      <div class="grid">
        <div>
          <label class="label">Discount kind</label>
          <select id="metaKind" class="input">
            <option value="percent">percent</option>
            <option value="fixed">fixed</option>
          </select>
        </div>
        <div>
          <label class="label">Value</label>
          <input id="metaValue" class="input" type="number" placeholder="20" />
        </div>
        <div>
          <label class="label">Title (optional)</label>
          <input id="metaTitle" class="input" placeholder="Gram perk: 20% off" />
        </div>
        <div>
          <label class="label">Usage limit (optional)</label>
          <input id="metaUsage" class="input" type="number" placeholder="1" />
        </div>
      </div>
    `;
            return;
        }

        // Soldac-only Shopify free product
        if (t === "shopify_free_product") {
            createFieldsEl.innerHTML = `
      <div class="grid">
        <div>
          <label class="label">Variant ID (numeric)</label>
          <input id="metaVariant" class="input" placeholder="56940868895101" />
        </div>
        <div>
          <label class="label">Quantity</label>
          <input id="metaQty" class="input" type="number" placeholder="1" />
        </div>
        <div>
          <label class="label">Title (optional)</label>
          <input id="metaTitle" class="input" placeholder="Free item" />
        </div>
        <div>
          <label class="label">Usage limit (optional)</label>
          <input id="metaUsage" class="input" type="number" placeholder="1" />
        </div>
      </div>
    `;
            return;
        }

        createFieldsEl.innerHTML = "";
    }


    createTypeEl.onchange = renderCreateFields;
    renderCreateFields();

    createBtn.onclick = async () => {
        const business_id = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
        if (!business_id) return alert("Business ID required");

        const gram_id = (createGramIdEl.value || "").trim();
        if (!gram_id) return alert("Gram ID required");

        const type = (createTypeEl.value || "").trim();
        const cooldown_seconds = Number(createCooldownEl.value || 0);
        const business_name = (createBusinessNameEl.value || "").trim() || null;

        let metadata = {};
        if(type === "discount") {
            const discount_percent = Number(document.getElementById("metaDiscountPercent")?.value || 0);
            const title = (document.getElementById("metaTitle")?.value || "").trim();
            metadata = { discount_percent };
            if (title) metadata.title = title;
        }

        if (type === "free_item") {
            const item_name = (document.getElementById("metaItemName")?.value || "").trim();
            const title = (document.getElementById("metaTitle")?.value || "").trim();
            metadata = { item_name };
            if (title) metadata.title = title;
        }

        if (type === "access") {
            const access_label = (document.getElementById("metaAccessLabel")?.value || "").trim();
            const title = (document.getElementById("metaTitle")?.value || "").trim();
            metadata = { access_label };
            if (title) metadata.title = title;
        }

        if (type === "shopify_discount") {
            const kind = (document.getElementById("metaKind")?.value || "percent").trim();
            const value = document.getElementById("metaValue")?.value;
            const title = (document.getElementById("metaTitle")?.value || "").trim();
            const usage = document.getElementById("metaUsage")?.value;

            metadata = { kind, value: value == null ? null : Number(value) };
            if (title) metadata.title = title;
            if (usage) metadata.usage_limit = Number(usage);
        }

        if (type === "shopify_free_product") {
            const variant_id = (document.getElementById("metaVariant")?.value || "").trim();
            const quantity = Number(document.getElementById("metaQty")?.value || 1);
            const title = (document.getElementById("metaTitle")?.value || "").trim();
            const usage = document.getElementById("metaUsage")?.value;

            metadata = { variant_id, quantity };
            if (title) metadata.title = title;
            if (usage) metadata.usage_limit = Number(usage);
        }

        setStatus("Creating perk…");
        const out = await apiPost(`${API_BASE}/api/vendor/perks`, {
            gram_id,
            business_name,
            type,
            cooldown_seconds,
            enabled: true,
            metadata,
        });


        debugEl.textContent = `HTTP ${out.status}\n` + (out.raw || "");
        if (!out.ok || !out.data?.ok) {
            setStatus(`Failed: ${out.data?.error || "UNKNOWN"}`);
            alert(`Failed: ${out.data?.error || "UNKNOWN"}`);
            return;
        }

        setStatus("Perk created. Refreshing…");
        await loadPerks();
    };


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
    function applyTypeLock() {
        const bid = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
        const isSoldac = bid === "SOLDAC"; // must match SOLDAC_BUSINESS_ID

        // Hide entire Create Perk card for non-Soldac
        if (createPerkCardEl) {
            createPerkCardEl.style.display = isSoldac ? "" : "none";
        }

        // Restrict the Type dropdown
        const allowedForPartners = new Set(["discount", "free_item", "access"]);
        Array.from(createTypeEl.options).forEach(opt => {
            const v = String(opt.value || "");
            if (isSoldac) {
                opt.disabled = false;
                opt.hidden = false;
            } else {
                const allowed = allowedForPartners.has(v);
                opt.disabled = !allowed;
                opt.hidden = !allowed;
            }
        });

        // If current selection becomes invalid, switch
        const cur = String(createTypeEl.value || "");
        if (!isSoldac && !allowedForPartners.has(cur)) {
            const firstAllowed = Array.from(createTypeEl.options).find(o => !o.disabled && !o.hidden);
            if (firstAllowed) createTypeEl.value = firstAllowed.value;
        }

        renderCreateFields();
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
  <button class="btn small" data-action="edit" data-id="${p.id}">Edit</button>
  <button class="btn small" data-action="delete" data-id="${p.id}">Delete</button>
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
          if (action === "edit") {
              const perk = perks.find(x => String(x.id) === String(id));
              if (!perk) return;

              const newCooldown = prompt("Cooldown seconds:", String(perk.cooldown_seconds ?? 0));
              if (newCooldown === null) return;

              setStatus("Updating…");

              const out = await fetch(`${API_BASE}/api/vendor/perks/${encodeURIComponent(id)}`, {
                  method: "PUT",
                  headers: {
                      "Content-Type": "application/json",
                      "X-Business-Id": (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim(),
                      "X-Vendor-Secret": (vendorSecretEl?.value || localStorage.getItem("vendor_secret") || "").trim(),
                  },
                  body: JSON.stringify({ cooldown_seconds: Number(newCooldown) })
              });

              const raw = await out.text();
              debugEl.textContent = `HTTP ${out.status}\n` + raw;

              let data = {};
              try { data = raw ? JSON.parse(raw) : {}; } catch (_) { }

              if (!out.ok || !data.ok) {
                  alert(`Failed: ${data.error || "UNKNOWN"}`);
                  return;
              }

              await loadPerks();
              return;
          }


          if (action === "delete") {
              if (!confirm("Delete this perk?")) return;
              setStatus("Deleting…");

              const out = await fetch(`${API_BASE}/api/vendor/perks/${encodeURIComponent(id)}`, {
                  method: "DELETE",
                  headers: {
                      "X-Business-Id": (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim(),
                      "X-Vendor-Secret": (vendorSecretEl?.value || localStorage.getItem("vendor_secret") || "").trim(),
                  }
              });

              const raw = await out.text();
              debugEl.textContent = `HTTP ${out.status}\n` + raw;

              let data = {};
              try { data = raw ? JSON.parse(raw) : {}; } catch (_) { }

              if (!out.ok || !data.ok) {
                  alert(`Failed: ${data.error || "UNKNOWN"}`);
                  return;
              }

              await loadPerks();
              return;
          }

        setStatus(`${action}...`);
          const url = `${API_BASE}/api/vendor/perks/${encodeURIComponent(id)}/${action}`;
          const out = await apiPost(url, {});



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
    applyTypeLock();
    showSoldacLinksIfNeeded();//
})();
