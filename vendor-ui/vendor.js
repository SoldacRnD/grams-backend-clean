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
    const profileNameEl = document.getElementById("profileName");
    const profileAddressEl = document.getElementById("profileAddress");
    const profileMapsUrlEl = document.getElementById("profileMapsUrl");
    const saveProfileBtn = document.getElementById("saveProfile");
    const profileDirectionsEl = document.getElementById("profileDirections");
    const mapsPreviewEl = document.getElementById("mapsPreview");
    const profileStatusEl = document.getElementById("profileStatus");
    const I18N = {
        en: {
            vendorPerks: "Vendor Perks",
            manageYourPerks: "Manage your perks (enable/disable) and keep grams snapshot updated.",
            businessId: "Business ID",
            vendorKey: "Vendor Key",
            loadPerks: "Load Perks",
            save: "Save",
            createPerk: "Create perk",
            refresh: "Refresh",
            validate: "Validate a Gram",
            statusSaved: "Saved.",
            businessProfileTitle: "Business profile",
            businessProfileHint: "This information is shown to collectors when redeeming perks.",
            saveProfile: "Save profile",
            connectedAs: "Connected as",
            vendorSessionActive: "Vendor session active on this device.",
            switchBusiness: "Switch business",
            logout: "Log out",
            loadYourGramsPerks: "Load your Gram perks",
        },
        pt: {
            vendorPerks: "Beneficios do Parceiro",
            manageYourPerks: "Gere os teus beneficios (ativar/desativar) e mantém o snapshot das Grams atualizado.",
            businessId: "ID do Negócio",
            vendorKey: "Chave do Parceiro",
            loadPerks: "Carregar os beneficios",
            save: "Guardar",
            createPerk: "Criar beneficio",
            refresh: "Atualizar",
            validate: "Validar uma Gram",
            statusSaved: "Guardado.",
            businessProfileTitle: "Perfil do negócio",
            businessProfileHint: "Esta informação é mostrada aos colecionadores ao resgatar os beneficios.",
            saveProfile: "Guardar perfil",
            connectedAs: "Ligado como",
            vendorSessionActive: "Sessão do parceiro ativa neste dispositivo.",
            switchBusiness: "Mudar de negócio",
            logout: "Terminar sessão",
            loadYourGramsPerks: "Carrega os beneficios dos teus Grams"
        }
    };
    function setProfileStatus(msg) {
        if (profileStatusEl) profileStatusEl.textContent = msg || "";
    }

    async function apiPut(url, body) {
        const bid = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
        const sec = (vendorSecretEl?.value || localStorage.getItem("vendor_secret") || "").trim();

        const res = await fetch(url, {
            method: "PUT",
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

    async function loadProfile() {
        if (!profileNameEl) return; // profile card not present
        setProfileStatus("Loading…");

        const out = await apiGet(`${API_BASE}/api/vendor/profile`);
        if (!out.ok || !out.data?.ok) {
            setProfileStatus(`Failed (${out.status})`);
            return;
        }

        const v = out.data.vendor || {};
        profileNameEl.value = v.business_name || "";
        profileAddressEl.value = v.address || "";
        profileMapsUrlEl.value = v.maps_url || "";

        const maps = (v.maps_url || "").trim();
        if (profileDirectionsEl) {
            profileDirectionsEl.style.display = maps ? "" : "none";
            profileDirectionsEl.href = maps || "#";
        }

        setProfileStatus("Loaded.");
    }

    async function saveProfile() {
        const payload = {
            business_name: (profileNameEl.value || "").trim() || null,
            address: (profileAddressEl.value || "").trim() || null,
            maps_url: (profileMapsUrlEl.value || "").trim() || null,
        };

        setProfileStatus("Saving…");
        const out = await apiPut(`${API_BASE}/api/vendor/profile`, payload);

        if (!out.ok || !out.data?.ok) {
            setProfileStatus(`Save failed (${out.status})`);
            alert(out.data?.error || "Save failed");
            return;
        }

        const v = out.data.vendor || {};
        const maps = (v.maps_url || "").trim();
        if (profileDirectionsEl) {
            profileDirectionsEl.style.display = maps ? "" : "none";
            profileDirectionsEl.href = maps || "#";
        }

        setProfileStatus("Saved ✅");
    }

    function getLang() {
        return localStorage.getItem("vendor_lang") || "en";
    }
    function setLang(lang) {
        localStorage.setItem("vendor_lang", lang);
        applyAuthUX();
        applyLang();
        const profileTitleEl = document.getElementById("profileTitle");
        if (profileTitleEl) profileTitleEl.textContent = t("businessProfileTitle");

        const profileHintEl = document.getElementById("profileHint");
        if (profileHintEl) profileHintEl.textContent = t("businessProfileHint");

        const saveProfileBtn = document.getElementById("saveProfile");
        if (saveProfileBtn) saveProfileBtn.textContent = t("saveProfile");
        const connectedAsEl = document.getElementById("connectedAs");
        if (connectedAsEl) {
            const bid = (localStorage.getItem("vendor_business_id") || "").trim();
            connectedAsEl.textContent = bid ? `${t("connectedAs")}: ${bid}` : t("connectedAs");
        }

        const vendorSessionHintEl = document.getElementById("vendorSessionHint");
        if (vendorSessionHintEl) vendorSessionHintEl.textContent = t("vendorSessionActive");

        const switchVendorBtn = document.getElementById("switchVendor");
        if (switchVendorBtn) switchVendorBtn.textContent = t("switchBusiness");

        const logoutVendorBtn = document.getElementById("logoutVendor");
        if (logoutVendorBtn) logoutVendorBtn.textContent = t("logout");


    }
    function t(key) {
        const lang = getLang();
        return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    }
    function applyLang() {
        // Headline + top copy
        const h1 = document.querySelector("h1");
        if (h1) h1.textContent = t("vendorPerks");

        const topMuted = document.querySelector("header.top p.muted");
        if (topMuted) topMuted.textContent = t("manageYourPerks");

        // Buttons (by id if present)
        const loadBtn = document.getElementById("loadPerks");
        if (loadBtn) loadBtn.textContent = t("loadYourGramsPerks");

        const refreshBtn = document.getElementById("refresh");
        if (refreshBtn) refreshBtn.textContent = t("refresh");

        const saveBtn = document.getElementById("saveBusinessId");
        if (saveBtn) saveBtn.textContent = t("save");

        const createBtn = document.getElementById("createPerk");
        if (createBtn) createBtn.textContent = t("createPerk");
    }

    function hasVendorAuth() {
        const bid = (localStorage.getItem("vendor_business_id") || "").trim();
        const sec = (localStorage.getItem("vendor_secret") || "").trim();
        return !!(bid && sec);
    }

    function applyAuthUX() {
        const authCard = document.getElementById("authCard");
        const onboardingBlock = document.getElementById("onboardingBlock");
        const connectedCard = document.getElementById("connectedCard");
        const connectedAs = document.getElementById("connectedAs");

        // Always hide onboarding block in Vendor UI
        if (onboardingBlock) onboardingBlock.style.display = "none";

        if (hasVendorAuth()) {
            const bid = (localStorage.getItem("vendor_business_id") || "").trim();
            if (connectedAs) connectedAs.textContent = `Connected as: ${bid}`;
            if (connectedCard) connectedCard.style.display = "";
            if (authCard) authCard.style.display = "none";
        } else {
            if (connectedCard) connectedCard.style.display = "none";
            if (authCard) authCard.style.display = "";
        }
        function isAdvancedMode() {
            const bid = (localStorage.getItem("vendor_business_id") || "").trim();
            const dbg = new URLSearchParams(location.search).get("debug") === "1";
            return bid === "SOLDAC" || dbg;
        }
        // Show vendor secret field only in advanced mode
        const adv = isAdvancedMode();
        document.getElementById("switchVendor").style.display = adv ? "" : "none";
        document.getElementById("logoutVendor").style.display = adv ? "" : "none";

    }

    document.getElementById("switchVendor")?.addEventListener("click", () => {
        document.getElementById("authCard").style.display = "";
        document.getElementById("connectedCard").style.display = "none";
    });

    document.getElementById("logoutVendor")?.addEventListener("click", () => {
        localStorage.removeItem("vendor_business_id");
        localStorage.removeItem("vendor_secret");
        location.reload();
    });


    function setProfileStatus(msg) {
        if (profileStatusEl) profileStatusEl.textContent = msg || "";
    }

    async function apiPut(url, body) {
        const bid = (businessIdEl.value || localStorage.getItem("vendor_business_id") || "").trim();
        const sec = (vendorSecretEl?.value || localStorage.getItem("vendor_secret") || "").trim();

        const res = await fetch(url, {
            method: "PUT",
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


    saveBusinessBtn.onclick = async () => {
    const bid = (businessIdEl.value || "").trim();
    const sec = (vendorSecretEl?.value || "").trim();

    if (!bid) return alert("Business ID required");
    if (!sec) return alert("Vendor Key required");

    localStorage.setItem("vendor_business_id", bid);
        localStorage.setItem("vendor_secret", sec);
        applyAuthUX();
        applyLang();
        applyTypeLock();
    autoLoadPerksIfReady();

    setStatus("Business ID + Vendor Key saved.");
    await loadProfile();
    showSoldacLinksIfNeeded();
};

    async function loadProfile() {
        if (!profileNameEl) return; // card not present

        setProfileStatus("Loading profile…");
        const out = await apiGet(`${API_BASE}/api/vendor/profile`);

        if (!out.ok || !out.data?.ok) {
            setProfileStatus(`Failed (${out.status})`);
            return;
        }

        const v = out.data.vendor || {};
        profileNameEl.value = v.business_name || "";
        profileAddressEl.value = v.address || "";
        profileMapsUrlEl.value = v.maps_url || "";

        const maps = (v.maps_url || "").trim();
        if (mapsPreviewEl) {
            mapsPreviewEl.style.display = maps ? "" : "none";
            mapsPreviewEl.href = maps || "#";
        }

        setProfileStatus("Profile loaded.");
    }

    async function saveProfile() {
        const payload = {
            business_name: (profileNameEl.value || "").trim() || null,
            address: (profileAddressEl.value || "").trim() || null,
            maps_url: (profileMapsUrlEl.value || "").trim() || null,
        };

        setProfileStatus("Saving…");
        const out = await apiPut(`${API_BASE}/api/vendor/profile`, payload);

        if (!out.ok || !out.data?.ok) {
            setProfileStatus(`Save failed (${out.status})`);
            alert(out.data?.error || "Save failed");
            return;
        }

        const v = out.data.vendor || {};
        const maps = (v.maps_url || "").trim();
        if (mapsPreviewEl) {
            mapsPreviewEl.style.display = maps ? "" : "none";
            mapsPreviewEl.href = maps || "#";
        }

        setProfileStatus("Saved ✅");
    }
    if (saveProfileBtn) saveProfileBtn.onclick = saveProfile;

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
      let url = `${API_BASE}/api/vendor/perks?business_id=${encodeURIComponent(business_id)}`;
      if (gram_id) url += `&gram_id=${encodeURIComponent(gram_id)}`;
    const out = await apiGet(url);

    debugEl.textContent = `HTTP ${out.status}\n` + (out.raw || "");

    if (!out.ok || !out.data?.ok) {
      setStatus(`Failed: ${out.data?.error || "UNKNOWN"}`);
      return;
    }

    render(out.data.perks || []);
    setStatus(`Loaded ${out.data.perks?.length || 0} perks.`);
    }
    if (saveProfileBtn) saveProfileBtn.onclick = saveProfile;

    // load after we have creds (on page load)
    loadProfile();

    // also reload profile after saving auth (so switching vendors updates profile)
    const oldSave = saveBusinessBtn.onclick;
    saveBusinessBtn.onclick = async () => {
        oldSave();
        await loadProfile();
    };


  loadBtn.onclick = loadPerks;
  refreshBtn.onclick = loadPerks;

    loadSaved();
    applyAuthUX();
    applyTypeLock();
    loadProfile();
    showSoldacLinksIfNeeded();
    document.getElementById("langEN")?.addEventListener("click", () => setLang("en"));
    document.getElementById("langPT")?.addEventListener("click", () => setLang("pt"));
    applyLang();
    if (hasVendorAuth()) {
        loadPerks(); // or whatever your function is called
    }
    async function autoLoadPerksIfReady() {
        if (!hasVendorAuth()) return;
        // optionally skip if already loaded
        setStatus?.("Loading perks…");
        await loadPerks(); // must be the same function used by the button
    }

    autoLoadPerksIfReady();
//
})();
