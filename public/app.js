import { compareDevicesByAddition, compareRemovedDevices, deviceLifecycleStatus } from "./device-order.js";

const ROUTES = {
  "/": "all",
  "/all-devices": "all",
  "/stock": "stock",
  "/zed-prices": "zed",
  "/content": "content",
  "/removed-devices": "removed",
  "/plans": "plans",
  "/device-master": "master"
};

const BOARD = {
  all: {
    title: "All Devices Board",
    subtitle: "Complete overview of devices currently available on the STC e-store",
    empty: "No devices match the current filters."
  },
  stock: {
    title: "Stock Management Board",
    subtitle: "Availability and quantity by device, storage, color, and item code",
    empty: "No stock rows match the current filters."
  },
  zed: {
    title: "zeed Price Board",
    subtitle: "Review zeed Price rental offers by device, item code, and commitment period",
    empty: "No zeed Price rows match the current filters."
  },
  content: {
    title: "Device Content Information Board",
    subtitle: "Review configured titles, descriptions, and specifications",
    empty: "No device content matches the current filters."
  },
  removed: {
    title: "Removed Devices Board",
    subtitle: "Historical record of devices no longer present in the live STC e-store",
    empty: "No removed devices match the current filters."
  },
  plans: {
    title: "Device by Plan Board",
    subtitle: "Select a plan to see every associated device offer",
    empty: "No devices are associated with the selected plan."
  },
  master: {
    title: "Device Master Information Board",
    subtitle: "Device and SKU master data with availability and product links",
    empty: "No master-data rows match the current filters."
  }
};

const state = {
  board: ROUTES[window.location.pathname.replace(/\/$/, "") || "/"] || "all",
  data: null,
  rows: [],
  filtered: []
};

const apiBase = String(window.STC_API_BASE || "").replace(/\/$/, "");
const apiUrl = (path) => `${apiBase}${path}`;
const els = Object.fromEntries([
  "pageTitle", "pageSubtitle", "refreshBtn", "exportBtn", "metrics", "toolbar",
  "status", "generatedAt", "resultCount", "tableHead", "tableBody", "dataTable",
  "sidebarFreshness", "drawer", "drawerTitle", "drawerSubtitle", "drawerImage",
  "drawerFacts", "drawerSpecs", "drawerColors", "drawerPlans", "drawerLink", "closeDrawer"
].map((id) => [id, document.querySelector(`#${id}`)]));

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const valueOrDash = (value) => String(value ?? "").trim() || "-";
const unique = (values) => [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
const currentDevices = () => (state.data?.devices || []).filter((device) => displayStatus(device) !== "REMOVED");
const removedDevices = () => (state.data?.devices || []).filter((device) => displayStatus(device) === "REMOVED");
const deviceMap = () => new Map(currentDevices().map((device) => [device.itemGroup, device]));
const rowsFor = (collection, device) => (collection || []).filter((row) => row.itemGroup === device.itemGroup);

function displayStatus(device) {
  return deviceLifecycleStatus(device);
}

function stockStatus(row) {
  if (row.qty !== "" && row.qty != null && Number.isFinite(Number(row.qty))) {
    return Number(row.qty) > 0 ? "IN STOCK" : "OUT OF STOCK";
  }
  if (row.available === true) return "IN STOCK";
  if (row.available === false) return "OUT OF STOCK";
  return "UNKNOWN";
}

function storageLabel(row) {
  const capacity = String(row.capacity || "").trim();
  const unit = String(row.unit || "").trim();
  if (!capacity) return unit;
  if (!unit || capacity.toLowerCase().endsWith(unit.toLowerCase())) return capacity;
  return `${capacity} ${unit}`;
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("en-KW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function setStatus(message, mode = "idle") {
  els.status.textContent = message;
  els.status.dataset.mode = mode;
}

function setLoading(loading) {
  els.refreshBtn.disabled = loading;
  els.refreshBtn.innerHTML = loading
    ? '<span class="spinner"></span> Fetching live data'
    : '<span aria-hidden="true">&#8635;</span> Refresh live data';
}

function filterField(id, label, options, placeholder = null) {
  if (placeholder != null) {
    return `<label class="field searchField"><span>${esc(label)}</span><input id="${id}" type="search" placeholder="${esc(placeholder)}" /></label>`;
  }
  return `<label class="field"><span>${esc(label)}</span><select id="${id}">${options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join("")}</select></label>`;
}

function options(values, allLabel) {
  return [{ value: "", label: allLabel }, ...unique(values).sort().map((value) => ({ value, label: value }))];
}

function setupPage() {
  const config = BOARD[state.board];
  document.title = `${config.title} | STC Device Operations`;
  els.pageTitle.textContent = config.title;
  els.pageSubtitle.textContent = config.subtitle;
  document.querySelectorAll(".boardNav a").forEach((link) => link.classList.toggle("active", link.dataset.board === state.board));

  const devices = state.board === "removed" ? removedDevices() : currentDevices();
  const brands = devices.map((device) => device.brand);
  const categories = devices.map((device) => device.category);
  const search = filterField("searchFilter", "Search", [], "Device, item group, item code...");
  const brand = filterField("brandFilter", "Brand", options(brands, "All brands"));
  const category = filterField("categoryFilter", "Category", options(categories, "All categories"));

  if (state.board === "all") {
    els.toolbar.innerHTML = search + filterField("statusFilter", "Status", [
      { value: "", label: "All current statuses" }, { value: "NEW", label: "NEW" }, { value: "EXISTING", label: "EXISTING" }
    ]) + category + brand;
    els.exportBtn.textContent = "Download Full Excel";
    els.exportBtn.href = apiUrl("/api/download-report");
  } else if (state.board === "stock") {
    els.toolbar.innerHTML = search + filterField("availabilityFilter", "Availability", [
      { value: "", label: "All availability" }, { value: "IN STOCK", label: "In Stock" },
      { value: "OUT OF STOCK", label: "Out of Stock" }, { value: "UNKNOWN", label: "Unknown" }
    ]) + brand + category;
    els.exportBtn.textContent = "Export Filtered Excel";
    els.exportBtn.href = "#";
  } else if (state.board === "zed") {
    const periods = (state.data?.zeed || []).map((row) => String(row.period || ""));
    els.toolbar.innerHTML = search + brand + filterField("periodFilter", "Period", options(periods, "All periods"));
    hideExport();
  } else if (state.board === "content") {
    els.toolbar.innerHTML = search + category + brand;
    hideExport();
  } else if (state.board === "removed") {
    els.toolbar.innerHTML = search + category + brand;
    hideExport();
  } else if (state.board === "plans") {
    const planNames = (state.data?.plans || []).map((row) => row.planName);
    els.toolbar.innerHTML = filterField("planFilter", "Plan", options(planNames, "All plans")) + search + brand;
    hideExport();
  } else {
    els.toolbar.innerHTML = search + filterField("availabilityFilter", "Availability", [
      { value: "", label: "All availability" }, { value: "IN STOCK", label: "In Stock" },
      { value: "OUT OF STOCK", label: "Out of Stock" }, { value: "UNKNOWN", label: "Unknown" }
    ]) + brand;
    hideExport();
  }

  els.toolbar.querySelectorAll("input, select").forEach((control) => {
    control.addEventListener(control.tagName === "INPUT" ? "input" : "change", applyFilters);
  });
}

function hideExport() {
  els.exportBtn.hidden = true;
}

function buildRows() {
  if (state.board === "removed") return removedDevices();
  const devices = currentDevices();
  const byGroup = deviceMap();
  if (state.board === "all" || state.board === "content") return devices;
  if (state.board === "zed") return (state.data?.zeed || []).filter((row) => byGroup.has(row.itemGroup));
  if (state.board === "plans") return (state.data?.plans || []).filter((row) => byGroup.has(row.itemGroup));

  const colorRows = (state.data?.colors || []).filter((row) => byGroup.has(row.itemGroup));
  const groupsWithColor = new Set(colorRows.map((row) => row.itemGroup));
  const fallbacks = devices.filter((device) => !groupsWithColor.has(device.itemGroup)).map((device) => ({
    itemGroup: device.itemGroup,
    model: device.deviceName,
    itemCode: device.defaultItemCode,
    colorName: "",
    capacity: "",
    unit: "",
    qty: "",
    available: null
  }));
  return [...colorRows, ...fallbacks];
}

function controlValue(id) {
  return document.querySelector(`#${id}`)?.value || "";
}

function rowContext(row) {
  return deviceMap().get(row.itemGroup) || row;
}

function applyFilters() {
  const query = controlValue("searchFilter").trim().toLowerCase();
  const brand = controlValue("brandFilter");
  const category = controlValue("categoryFilter");
  const status = controlValue("statusFilter");
  const availability = controlValue("availabilityFilter");
  const period = controlValue("periodFilter");
  const plan = controlValue("planFilter");

  state.filtered = state.rows.filter((row) => {
    const device = rowContext(row);
    const haystack = [...Object.values(row), ...Object.values(device)].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) &&
      (!brand || device.brand === brand) &&
      (!category || device.category === category) &&
      (!status || displayStatus(device) === status) &&
      (!availability || stockStatus(row) === availability) &&
      (!period || String(row.period || "") === period) &&
      (!plan || row.planName === plan);
  }).sort((a, b) => state.board === "removed"
    ? compareRemovedDevices(a, b)
    : compareDevicesByAddition(rowContext(a), rowContext(b)));
  renderMetrics();
  renderTable();
  updateExportLink();
}

function metric(value, label) {
  return `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
}

function renderMetrics() {
  const current = currentDevices();
  let cards = [];
  if (state.board === "all") {
    cards = [
      [state.filtered.length, "Filtered devices"],
      [current.length, "Current devices"],
      [current.filter((device) => displayStatus(device) === "NEW").length, "New (first 15 days)"],
      [unique(current.map((device) => device.brand)).length, "Brands"]
    ];
  } else if (state.board === "stock" || state.board === "master") {
    cards = [
      [state.filtered.length, "Filtered SKU rows"],
      [state.rows.filter((row) => stockStatus(row) === "IN STOCK").length, "In stock"],
      [state.rows.filter((row) => stockStatus(row) === "OUT OF STOCK").length, "Out of stock"],
      [state.rows.filter((row) => stockStatus(row) === "UNKNOWN").length, "Stock unknown"]
    ];
  } else if (state.board === "zed") {
    cards = [[state.filtered.length, "Filtered offers"], [unique(state.rows.map((row) => row.itemGroup)).length, "Devices"], [unique(state.rows.map((row) => row.period)).length, "Periods"], [state.rows.length, "Total zeed Price offers"]];
  } else if (state.board === "content") {
    cards = [[state.filtered.length, "Filtered devices"], [state.rows.filter((row) => row.englishDescription).length, "With English content"], [state.rows.filter((row) => row.arabicDescription).length, "With Arabic content"], [state.rows.length, "Current devices"]];
  } else if (state.board === "removed") {
    cards = [[state.filtered.length, "Filtered removed"], [state.rows.length, "Removed history"], [unique(state.rows.map((row) => row.category)).length, "Categories"], [unique(state.rows.map((row) => row.brand)).length, "Brands"]];
  } else {
    cards = [[state.filtered.length, "Filtered offers"], [unique(state.filtered.map((row) => row.itemGroup)).length, "Matching devices"], [unique(state.rows.map((row) => row.planName)).length, "Available plans"], [state.rows.length, "Total plan offers"]];
  }
  els.metrics.innerHTML = cards.map(([value, label]) => metric(value, label)).join("");
}

function columnsForBoard() {
  const urlLink = (url) => url ? `<a class="tableLink" href="${esc(url)}" target="_blank" rel="noreferrer">Open</a>` : "-";
  const link = (device) => urlLink(device.productUrl);
  if (state.board === "all") return [
    ["No.", (_, i) => i + 1], ["Status", (d) => pill(displayStatus(d))], ["Added Date", (d) => formatDate(d.firstSeenAt)], ["Label", (d) => valueOrDash(d.label)],
    ["Category", (d) => valueOrDash(d.category)], ["Brand", (d) => valueOrDash(d.brand)], ["Device", (d) => valueOrDash(d.deviceName)],
    ["Item group", (d) => valueOrDash(d.itemGroup)], ["Default item code", (d) => valueOrDash(d.defaultItemCode)],
    ["Starting", (d) => valueOrDash(d.cardStartingPriceText)], ["zeed Price", (d) => valueOrDash(d.cardZeedPriceText)],
    ["Cash", (d) => valueOrDash(d.cardCashPriceText)], ["Product URL", (d) => link(d)],
    ["Storage", (d) => valueOrDash(d.storageOptions)], ["Colors", (d) => valueOrDash(d.colorNames)]
  ];
  if (state.board === "stock") return [
    ["No.", (_, i) => i + 1], ["Availability", (r) => stockPill(r)], ["Stock", (r) => valueOrDash(r.qty)],
    ["Brand", (r) => valueOrDash(rowContext(r).brand)], ["Device", (r) => valueOrDash(rowContext(r).deviceName || r.model)],
    ["Item group", (r) => valueOrDash(r.itemGroup)], ["Item code", (r) => valueOrDash(r.itemCode)],
    ["Storage", (r) => valueOrDash(storageLabel(r))], ["Color", (r) => valueOrDash(r.colorName)],
    ["Preorder", (r) => r.preorder === true ? "YES" : "NO"], ["Standalone price", (r) => valueOrDash(r.standalonePrice)],
    ["Device URL", (r) => link(rowContext(r))]
  ];
  if (state.board === "zed") return [
    ["No.", (_, i) => i + 1], ["Brand", (r) => valueOrDash(rowContext(r).brand)], ["Device", (r) => valueOrDash(rowContext(r).deviceName || r.model)],
    ["Item group", (r) => valueOrDash(r.itemGroup)], ["Item code", (r) => valueOrDash(r.itemCode)], ["Storage", (r) => valueOrDash(r.name)],
    ["Period", (r) => r.period ? `${esc(r.period)} months` : "-"], ["Device rent", (r) => price(r.deviceRent, r.currency)],
    ["Minimum rental", (r) => price(r.minimumRentalPrice, r.currency)], ["Commitment", (r) => valueOrDash(r.commitmentDescription)],
    ["Parent plan", (r) => valueOrDash(r.parentPlan)], ["Device URL", (r) => link(rowContext(r))]
  ];
  if (state.board === "content") return [
    ["No.", (_, i) => i + 1], ["Brand", (d) => valueOrDash(d.brand)], ["Item group", (d) => valueOrDash(d.itemGroup)],
    ["English Device Title", (d) => valueOrDash(d.englishDeviceTitle)], ["Arabic Device Title", (d) => valueOrDash(d.arabicDeviceTitle)],
    ["English Description", (d) => valueOrDash(d.englishDescription)], ["Arabic Description", (d) => valueOrDash(d.arabicDescription)],
    ["English PDP URL", (d) => urlLink(d.englishPdpUrl)], ["Arabic PDP URL", (d) => urlLink(d.arabicPdpUrl)]
  ];
  if (state.board === "removed") return [
    ["No.", (_, i) => i + 1], ["Status", (d) => pill(displayStatus(d))], ["Removed Date", (d) => formatDate(d.removedAt)],
    ["Added Date", (d) => formatDate(d.firstSeenAt)], ["Brand", (d) => valueOrDash(d.brand)], ["Category", (d) => valueOrDash(d.category)],
    ["Device Name", (d) => valueOrDash(d.deviceName)], ["Item group", (d) => valueOrDash(d.itemGroup)],
    ["Default item code", (d) => valueOrDash(d.defaultItemCode)], ["Product URL", (d) => link(d)]
  ];
  if (state.board === "plans") return [
    ["No.", (_, i) => i + 1], ["Plan", (r) => valueOrDash(r.planName)], ["Brand", (r) => valueOrDash(rowContext(r).brand)],
    ["Device", (r) => valueOrDash(rowContext(r).deviceName || r.model)], ["Item code", (r) => valueOrDash(r.itemCode)],
    ["Period", (r) => r.period ? `${esc(r.period)} months` : "-"], ["Device rent", (r) => price(r.deviceRent, r.currency)],
    ["Plan price", (r) => price(r.parentPlanPrice, r.currency)], ["Commitment", (r) => valueOrDash(r.commitmentDescription)],
    ["Benefits", (r) => valueOrDash(r.benefits)], ["Device URL", (r) => link(rowContext(r))]
  ];
  return [
    ["No.", (_, i) => i + 1], ["Device Name", (r) => valueOrDash(rowContext(r).deviceName || r.model)],
    ["Item Group", (r) => valueOrDash(r.itemGroup)], ["Default Item Code", (r) => valueOrDash(rowContext(r).defaultItemCode)],
    ["Item Code", (r) => valueOrDash(r.itemCode)], ["Color Name", (r) => valueOrDash(r.colorName)],
    ["Availability Status", (r) => stockPill(r)], ["Device URL", (r) => link(rowContext(r))]
  ];
}

function pill(status) {
  return `<span class="statusPill ${esc(status.toLowerCase().replaceAll(" ", "-"))}">${esc(status)}</span>`;
}

function stockPill(row) {
  return pill(stockStatus(row));
}

function price(value, currency) {
  return value === "" || value == null ? "-" : `${esc(currency || "KWD")} ${esc(value)}`;
}

function specsText(device) {
  const rows = rowsFor(state.data?.specs, device);
  return rows.length ? rows.map((row) => `${esc(row.specTitle)}: ${esc(row.specValue)}`).join(" | ") : "-";
}

function renderTable() {
  const columns = columnsForBoard();
  const columnClass = (label) => {
    if (["Device", "Device Name", "English Device Title", "Arabic Device Title"].includes(label)) return "deviceNameColumn";
    if (label.includes("Description")) return "descriptionColumn";
    if (["Brand", "Category"].includes(label)) return "nameColumn";
    if (label.toLowerCase().includes("item group")) return "itemGroupColumn";
    return "";
  };
  els.tableHead.innerHTML = columns.map(([label]) => `<th class="${columnClass(label)}">${esc(label)}</th>`).join("");
  els.dataTable.style.minWidth = `${Math.max(920, columns.length * 145)}px`;
  els.resultCount.textContent = `${state.filtered.length} results`;
  if (!state.filtered.length) {
    els.tableBody.innerHTML = `<tr><td colspan="${columns.length}" class="empty">${esc(BOARD[state.board].empty)}</td></tr>`;
    return;
  }
  els.tableBody.innerHTML = state.filtered.map((row, index) => `<tr data-index="${index}" tabindex="0">${columns.map(([label, render]) => `<td class="${columnClass(label)}">${render(row, index)}</td>`).join("")}</tr>`).join("");
}

function updateExportLink() {
  if (state.board !== "stock") return;
  const params = new URLSearchParams({ board: "stock" });
  for (const id of ["searchFilter", "availabilityFilter", "brandFilter", "categoryFilter"]) {
    const value = controlValue(id);
    if (value) params.set(id.replace("Filter", ""), value);
  }
  els.exportBtn.href = apiUrl(`/api/download-board?${params}`);
}

function fact(label, value) {
  return `<div class="fact"><span>${esc(label)}</span><strong>${esc(valueOrDash(value))}</strong></div>`;
}

function renderList(container, rows, emptyText) {
  container.innerHTML = rows.length ? rows.map((row) => `<li>${row}</li>`).join("") : `<li class="muted">${esc(emptyText)}</li>`;
}

function openDrawer(row) {
  const device = rowContext(row);
  if (!device?.itemGroup) return;
  const colors = rowsFor(state.data?.colors, device);
  const specs = rowsFor(state.data?.specs, device);
  const plans = rowsFor(state.data?.plans, device);
  const zeed = rowsFor(state.data?.zeed, device);
  const images = rowsFor(state.data?.images, device);
  els.drawerTitle.textContent = device.deviceName || device.productName || row.model || "Device details";
  els.drawerSubtitle.textContent = [device.label, device.brand, device.category].filter(Boolean).join(" / ");
  const imageUrl = images[0]?.imageUrl || device.firstImageUrl || "";
  els.drawerImage.hidden = !imageUrl;
  if (imageUrl) els.drawerImage.src = imageUrl;
  els.drawerImage.alt = device.deviceName || "Device image";
  els.drawerFacts.innerHTML = [
    fact("Status", displayStatus(device)), fact("Added Date", formatDate(device.firstSeenAt)), fact("Item group", device.itemGroup), fact("Default item code", device.defaultItemCode),
    fact("Starting price", device.cardStartingPriceText), fact("zeed Price", device.cardZeedPriceText), fact("Cash price", device.cardCashPriceText),
    fact("Color / SKU rows", colors.length), fact("Plan offers", plans.length), fact("zeed Price offers", zeed.length), fact("Last seen", formatDate(device.lastSeenAt))
  ].join("");
  renderList(els.drawerSpecs, specs.map((item) => `<strong>${esc(item.specTitle || "Specification")}</strong><span>${esc(item.specValue)}</span>`), "No specifications found.");
  renderList(els.drawerColors, colors.map((item) => `<strong>${esc([storageLabel(item), item.colorName].filter(Boolean).join(" / "))}</strong><span>${esc(item.itemCode || "-")} | ${esc(stockStatus(item))} | Qty ${esc(valueOrDash(item.qty))}</span>`), "No color/SKU rows found.");
  renderList(els.drawerPlans, [
    ...plans.slice(0, 12).map((item) => `<strong>${esc(item.planName || "Plan")}</strong><span>${esc(item.period || "-")} months | ${price(item.deviceRent, item.currency)}</span>`),
    ...zeed.slice(0, 12).map((item) => `<strong>zeed Price ${esc(item.name || "")}</strong><span>${esc(item.period || "-")} months | ${price(item.deviceRent, item.currency)}</span>`)
  ], "No plan or zeed Price offers found.");
  els.drawerLink.href = device.productUrl || "#";
  els.drawerLink.hidden = !device.productUrl;
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
}

async function loadData(live = false) {
  setLoading(true);
  setStatus(live ? "Fetching live data from STC..." : "Loading saved STC snapshot...", "busy");
  try {
    const response = await fetch(apiUrl(live ? "/api/live-data" : "/api/cached-data"), { cache: "no-store" });
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    state.data = await response.json();
    if (!state.data?.devices?.length) throw new Error("No device data is available.");
    setupPage();
    state.rows = buildRows();
    applyFilters();
    const freshness = formatDate(state.data.generatedAt);
    els.generatedAt.textContent = state.data.fetchWarning ? `Saved snapshot ${freshness}` : `Generated ${freshness}`;
    els.sidebarFreshness.textContent = `Updated ${freshness}`;
    setStatus(state.data.fetchWarning ? `Saved data shown: ${state.data.fetchWarning}` : "Latest saved data loaded successfully", state.data.fetchWarning ? "error" : "ok");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to load device data", "error");
  } finally {
    setLoading(false);
  }
}

els.refreshBtn.addEventListener("click", () => loadData(true));
els.exportBtn.addEventListener("click", () => setStatus("Preparing Excel download...", "busy"));
els.tableBody.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const tr = event.target.closest("tr[data-index]");
  if (tr) openDrawer(state.filtered[Number(tr.dataset.index)]);
});
els.tableBody.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const tr = event.target.closest("tr[data-index]");
    if (tr) openDrawer(state.filtered[Number(tr.dataset.index)]);
  }
});
els.closeDrawer.addEventListener("click", () => {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") els.closeDrawer.click();
});

loadData(false);
