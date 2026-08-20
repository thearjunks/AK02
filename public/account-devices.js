const state = { data: { accounts: [], devices: [], generatedAt: null }, filtered: [] };
const $ = (id) => document.querySelector(`#${id}`);
const els = Object.fromEntries([
  "accountForm", "msisdnInput", "passwordInput", "connectBtn", "refreshAllBtn",
  "connectionMessage", "accounts", "metrics", "searchInput", "accountFilter",
  "availabilityFilter", "status", "generatedAt", "resultCount", "tableBody", "sidebarFreshness",
].map((id) => [id, $(id)]));

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-KW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function setBusy(busy, message = "") {
  els.connectBtn.disabled = busy;
  els.refreshAllBtn.disabled = busy;
  els.connectBtn.textContent = busy ? "Connecting..." : "Connect account";
  if (message) setStatus(message, "busy");
}

function setStatus(message, mode = "idle") {
  els.status.textContent = message;
  els.status.dataset.mode = mode;
}

function showMessage(message, mode) {
  els.connectionMessage.hidden = false;
  els.connectionMessage.className = `connectionMessage ${mode}`;
  els.connectionMessage.textContent = message;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
  return data;
}

function price(value, currency = "KWD") {
  return value === "" || value == null ? "-" : `${currency} ${value}`;
}

function selectedAccountValue(device) {
  const msisdn = els.accountFilter.value;
  if (msisdn) return device.accountValues?.find((value) => value.msisdn === msisdn) || {};
  const values = device.accountValues || [];
  const uniqueValue = (key) => [...new Set(values.map((value) => value[key]).filter((value) => value !== "" && value != null))].join(" / ");
  return {
    available: device.available,
    quantity: uniqueValue("quantity"),
    startingPrice: uniqueValue("startingPrice"),
    retailPrice: uniqueValue("retailPrice"),
    zeedPrice: uniqueValue("zeedPrice"),
  };
}

function renderAccounts() {
  if (!state.data.accounts.length) {
    els.accounts.innerHTML = '<div class="accountEmpty">No STC accounts have been added.</div>';
    return;
  }
  els.accounts.innerHTML = state.data.accounts
    .slice().sort((a, b) => a.msisdn.localeCompare(b.msisdn))
    .map((account) => `<article class="accountRow">
      <div><strong>${esc(account.msisdn)}</strong><span>${esc(account.displayName || "STC account")}</span></div>
      <span class="statusPill ${account.status === "CONNECTED" ? "active" : "removed"}">${esc(account.status === "CONNECTED" ? "CONNECTED" : "FAILED")}</span>
      <div class="accountMeta"><strong>${esc(account.message || "Not connected")}</strong><span>${esc(account.deviceCount || 0)} devices | ${esc(formatDate(account.lastFetchedAt || account.lastAttemptedAt))}</span></div>
      <div class="accountActions">
        <button type="button" class="iconButton refreshAccount" data-msisdn="${esc(account.msisdn)}" title="Refresh this account" aria-label="Refresh ${esc(account.msisdn)}">&#8635;</button>
        <button type="button" class="iconButton danger removeAccount" data-msisdn="${esc(account.msisdn)}" title="Remove this account" aria-label="Remove ${esc(account.msisdn)}">&#215;</button>
      </div>
    </article>`).join("");
}

function renderFilters() {
  const selected = els.accountFilter.value;
  els.accountFilter.innerHTML = '<option value="">All accounts</option>' + state.data.accounts
    .map((account) => account.msisdn).sort()
    .map((msisdn) => `<option value="${esc(msisdn)}">${esc(msisdn)}</option>`).join("");
  if ([...els.accountFilter.options].some((option) => option.value === selected)) els.accountFilter.value = selected;
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  const account = els.accountFilter.value;
  const availability = els.availabilityFilter.value;
  state.filtered = (state.data.devices || []).filter((device) => {
    const values = selectedAccountValue(device);
    const stock = values.available ? "IN STOCK" : "OUT OF STOCK";
    const haystack = [device.productId, device.title, device.brand, device.itemType, ...(device.accountMsisdns || [])].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (!account || device.accountMsisdns?.includes(account))
      && (!availability || stock === availability);
  });
  renderSummary();
  renderTable();
}

function renderSummary() {
  const connected = state.data.accounts.filter((account) => account.status === "CONNECTED").length;
  const inStock = state.filtered.filter((device) => selectedAccountValue(device).available).length;
  els.metrics.innerHTML = [
    [state.data.accounts.length, "Saved accounts"],
    [connected, "Connected successfully"],
    [state.data.devices.length, "Unique account devices"],
    [inStock, "In-stock results"],
  ].map(([value, label]) => `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join("");
  els.generatedAt.textContent = `Generated ${formatDate(state.data.generatedAt)}`;
  els.sidebarFreshness.textContent = state.data.generatedAt ? formatDate(state.data.generatedAt) : "Not fetched";
  els.resultCount.textContent = `${state.filtered.length} results`;
}

function renderTable() {
  if (!state.filtered.length) {
    els.tableBody.innerHTML = '<tr><td colspan="11" class="empty">No account device information matches the current filters.</td></tr>';
    return;
  }
  els.tableBody.innerHTML = state.filtered.map((device, index) => {
    const values = selectedAccountValue(device);
    const stock = values.available ? "IN STOCK" : "OUT OF STOCK";
    return `<tr>
      <td>${index + 1}</td>
      <td>${esc((device.accountMsisdns || []).join(", "))}</td>
      <td>${esc(device.productId || "-")}</td>
      <td>${esc(device.brand || "-")}</td>
      <td class="strong deviceNameColumn">${esc(device.title || "-")}</td>
      <td>${esc(device.itemType || "-")}</td>
      <td><span class="statusPill ${values.available ? "in-stock" : "out-of-stock"}">${stock}</span></td>
      <td>${esc(values.quantity === "" || values.quantity == null ? "-" : values.quantity)}</td>
      <td>${esc(price(values.startingPrice, device.currency))}</td>
      <td>${esc(price(values.retailPrice, device.currency))}</td>
      <td>${esc(price(values.zeedPrice, device.currency))}</td>
    </tr>`;
  }).join("");
}

function update(data, message = "Saved account data loaded successfully.") {
  state.data = data;
  renderAccounts();
  renderFilters();
  applyFilters();
  setStatus(message, "ok");
}

els.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true, "Connecting securely to STC...");
  try {
    const data = await request("/api/stc-accounts", {
      method: "POST",
      body: JSON.stringify({ msisdn: els.msisdnInput.value, password: els.passwordInput.value }),
    });
    const msisdn = els.msisdnInput.value.replace(/\D/g, "").slice(-8);
    els.accountForm.reset();
    update(data, `Connected Successfully: ${msisdn}`);
    showMessage(`Connected Successfully: ${msisdn}. Latest STC Selfcare device information has been fetched.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

els.refreshAllBtn.addEventListener("click", async () => {
  setBusy(true, "Refreshing all saved STC accounts...");
  try {
    const data = await request("/api/stc-accounts/refresh", { method: "POST", body: "{}" });
    const failed = data.accounts.filter((account) => account.status === "FAILED");
    update(data, failed.length ? `${failed.length} account connection failed.` : "All account data refreshed.");
    showMessage(failed.length ? `${failed.length} account connection failed. Check the account status below.` : "All saved STC accounts were refreshed.", failed.length ? "error" : "success");
  } catch (error) {
    setStatus(error.message, "error");
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

els.accounts.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-msisdn]");
  if (!button) return;
  const msisdn = button.dataset.msisdn;
  setBusy(true, button.classList.contains("removeAccount") ? `Removing ${msisdn}...` : `Refreshing ${msisdn}...`);
  try {
    if (button.classList.contains("removeAccount")) {
      update(await request(`/api/stc-accounts/${encodeURIComponent(msisdn)}`, { method: "DELETE" }), `Removed ${msisdn}.`);
    } else {
      update(await request("/api/stc-accounts/refresh", { method: "POST", body: JSON.stringify({ msisdn }) }), `Refreshed ${msisdn}.`);
    }
  } catch (error) {
    setStatus(error.message, "error");
    showMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
});

[els.searchInput, els.accountFilter, els.availabilityFilter].forEach((input) => input.addEventListener("input", applyFilters));

async function load() {
  try {
    const saved = await request("/api/stc-accounts");
    update(saved);
    const age = Date.now() - Date.parse(saved.generatedAt || 0);
    if (saved.accounts.length && age > 15 * 60 * 1000) {
      setBusy(true, "Refreshing stale account data...");
      const fresh = await request("/api/stc-accounts/refresh", { method: "POST", body: "{}" });
      const failed = fresh.accounts.filter((account) => account.status === "FAILED");
      update(fresh, failed.length ? `${failed.length} account connection failed.` : "Latest account data fetched from STC.");
      if (failed.length) showMessage(`${failed.length} account connection failed. The last successful rows were retained.`, "error");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

load();
