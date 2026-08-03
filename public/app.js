const state = {
  data: null,
  filtered: [],
  activeDevice: null
};

const apiBase = String(window.STC_API_BASE || "").replace(/\/$/, "");
const apiUrl = (path) => `${apiBase}${path}`;

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  status: document.querySelector("#status"),
  generatedAt: document.querySelector("#generatedAt"),
  totalDevices: document.querySelector("#totalDevices"),
  activeDevices: document.querySelector("#activeDevices"),
  addedDevices: document.querySelector("#addedDevices"),
  removedDevices: document.querySelector("#removedDevices"),
  totalSkus: document.querySelector("#totalSkus"),
  totalPlans: document.querySelector("#totalPlans"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  brandFilter: document.querySelector("#brandFilter"),
  resultCount: document.querySelector("#resultCount"),
  tableBody: document.querySelector("#tableBody"),
  drawer: document.querySelector("#drawer"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerSubtitle: document.querySelector("#drawerSubtitle"),
  drawerImage: document.querySelector("#drawerImage"),
  drawerFacts: document.querySelector("#drawerFacts"),
  drawerSpecs: document.querySelector("#drawerSpecs"),
  drawerColors: document.querySelector("#drawerColors"),
  drawerPlans: document.querySelector("#drawerPlans"),
  drawerLink: document.querySelector("#drawerLink"),
  closeDrawer: document.querySelector("#closeDrawer")
};

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const moneyText = (...values) => values.find((value) => String(value ?? "").trim()) || "-";

function displayStatus(device) {
  const status = String(device?.deviceStatus || "ACTIVE").trim().toUpperCase();
  return status === "RESTORED" ? "ADDED" : status;
}

function rowsFor(collection, device) {
  return (collection || []).filter((row) => row.itemGroup === device.itemGroup);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function setStatus(message, mode = "idle") {
  els.status.textContent = message;
  els.status.dataset.mode = mode;
}

function setLoading(isLoading) {
  els.refreshBtn.disabled = isLoading;
  els.refreshBtn.innerHTML = isLoading
    ? '<span class="spinner"></span> Fetching live data'
    : '<span aria-hidden="true">&#8635;</span> Refresh live data';
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("en-KW", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function updateMetrics() {
  const data = state.data || {};
  const summary = data.changeSummary || {};
  els.totalDevices.textContent = summary.displayedTotal ?? data.devices?.length ?? 0;
  els.activeDevices.textContent = summary.currentTotal ?? data.devices?.filter((device) => device.deviceStatus !== "REMOVED").length ?? 0;
  els.addedDevices.textContent = (summary.added ?? 0) + (summary.restored ?? 0);
  els.removedDevices.textContent = summary.removed ?? data.devices?.filter((device) => device.deviceStatus === "REMOVED").length ?? 0;
  els.totalSkus.textContent = data.colors?.length ?? 0;
  els.totalPlans.textContent = (data.plans?.length ?? 0) + (data.zeed?.length ?? 0);
  els.generatedAt.textContent = `Generated ${formatDate(data.generatedAt)}`;
}

function populateFilters() {
  const devices = state.data?.devices || [];
  const currentCategory = els.categoryFilter.value;
  const currentBrand = els.brandFilter.value;

  const categories = unique(devices.map((device) => device.category)).sort();
  const brands = unique(devices.map((device) => device.brand)).sort();

  els.categoryFilter.innerHTML = '<option value="">All categories</option>';
  for (const category of categories) {
    els.categoryFilter.insertAdjacentHTML("beforeend", `<option value="${esc(category)}">${esc(category)}</option>`);
  }
  els.brandFilter.innerHTML = '<option value="">All brands</option>';
  for (const brand of brands) {
    els.brandFilter.insertAdjacentHTML("beforeend", `<option value="${esc(brand)}">${esc(brand)}</option>`);
  }

  els.categoryFilter.value = categories.includes(currentCategory) ? currentCategory : "";
  els.brandFilter.value = brands.includes(currentBrand) ? currentBrand : "";
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  const category = els.categoryFilter.value;
  const brand = els.brandFilter.value;

  state.filtered = (state.data?.devices || []).filter((device) => {
    const haystack = [
      device.label,
      displayStatus(device),
      device.category,
      device.brand,
      device.deviceName,
      device.productName,
      device.itemGroup,
      device.defaultItemCode,
      device.productUrl,
      device.cardStartingPriceText,
      device.cardZeedPriceText,
      device.cardCashPriceText
    ]
      .join(" ")
      .toLowerCase();

    return (
      (!query || haystack.includes(query)) &&
      (!status || displayStatus(device) === status) &&
      (!category || device.category === category) &&
      (!brand || device.brand === brand)
    );
  });

  renderTable();
}

function renderTable() {
  els.resultCount.textContent = `${state.filtered.length} results`;
  if (!state.filtered.length) {
    els.tableBody.innerHTML = `
      <tr>
        <td colspan="14" class="empty">No devices match the current filters.</td>
      </tr>`;
    return;
  }

  els.tableBody.innerHTML = state.filtered
    .map((device, index) => {
      const skuRows = rowsFor(state.data.colors, device);
      const colors = unique(skuRows.map((row) => row.colorName)).join(", ");
      const capacities = unique(rowsFor(state.data.capacities, device).map((row) => row.capacity)).join(", ");
      const skuPreview = skuRows
        .slice(0, 3)
        .map((row) => `${row.capacity || ""}${row.unit || ""} ${row.colorName || ""}: ${row.itemCode || "-"}`.trim())
        .join(" / ");
      const skuMore = skuRows.length > 3 ? ` +${skuRows.length - 3} more` : "";
      return `
        <tr data-index="${index}" tabindex="0">
          <td>${index + 1}</td>
          <td><span class="statusPill ${esc(displayStatus(device).toLowerCase())}">${esc(displayStatus(device))}</span></td>
          <td>${esc(device.label || "-")}</td>
          <td>${esc(device.category || "-")}</td>
          <td>${esc(device.brand || "-")}</td>
          <td class="strong">${esc(device.deviceName || device.productName || "-")}</td>
          <td>${esc(device.itemGroup || "-")}</td>
          <td>${esc(device.defaultItemCode || "-")}</td>
          <td>${esc(moneyText(device.cardStartingPriceText, device.startingPriceText))}</td>
          <td>${esc(moneyText(device.cardZeedPriceText, device.zeedPriceText))}</td>
          <td>${esc(moneyText(device.cardCashPriceText, device.cashPriceText))}</td>
          <td>${device.productUrl ? `<a class="tableLink" href="${esc(device.productUrl)}" target="_blank" rel="noreferrer">Open</a>` : "-"}</td>
          <td>${esc([capacities, colors].filter(Boolean).join(" | ") || "-")}</td>
          <td class="skuCell">${esc((skuPreview || "-") + skuMore)}</td>
        </tr>`;
    })
    .join("");
}

function fact(label, value) {
  return `
    <div class="fact">
      <span>${esc(label)}</span>
      <strong>${esc(value || "-")}</strong>
    </div>`;
}

function renderList(container, rows, emptyText) {
  if (!rows.length) {
    container.innerHTML = `<p class="muted">${esc(emptyText)}</p>`;
    return;
  }
  container.innerHTML = rows.map((row) => `<li>${row}</li>`).join("");
}

function openDrawer(device) {
  state.activeDevice = device;
  const colors = rowsFor(state.data.colors, device);
  const specs = rowsFor(state.data.specs, device);
  const plans = rowsFor(state.data.plans, device);
  const zeed = rowsFor(state.data.zeed, device);
  const capacities = rowsFor(state.data.capacities, device);
  const images = rowsFor(state.data.images, device);

  els.drawerTitle.textContent = device.deviceName || device.productName || "Device details";
  els.drawerSubtitle.textContent = [device.label, device.brand, device.category].filter(Boolean).join(" / ");
  const imageUrl = images[0]?.imageUrl || device.firstImageUrl || device.imageUrl || "";
  if (imageUrl) {
    els.drawerImage.src = imageUrl;
  } else {
    els.drawerImage.removeAttribute("src");
  }
  els.drawerImage.alt = device.deviceName || device.productName || "Device image";
  els.drawerImage.hidden = !imageUrl;

  els.drawerFacts.innerHTML = [
    fact("Starting price", moneyText(device.cardStartingPriceText, device.startingPriceText)),
    fact("Status", displayStatus(device)),
    fact("First seen", formatDate(device.firstSeenAt)),
    fact("Last seen", formatDate(device.lastSeenAt)),
    fact("Removed at", device.removedAt ? formatDate(device.removedAt) : ""),
    fact("Item group", device.itemGroup),
    fact("Item code", device.defaultItemCode),
    fact("Product URL", device.productUrl),
    fact("Zeed price", moneyText(device.cardZeedPriceText, device.zeedPriceText)),
    fact("Cash price", moneyText(device.cardCashPriceText, device.cashPriceText)),
    fact("Storage", unique(capacities.map((row) => row.capacity)).join(", ")),
    fact("Colors", unique(colors.map((row) => row.colorName)).join(", ")),
    fact("Available SKUs", colors.length),
    fact("Plan offers", plans.length),
    fact("Zeed offers", zeed.length)
  ].join("");

  renderList(
    els.drawerSpecs,
    specs.map((row) => `<strong>${esc(row.specTitle || row.specName || row.specKey || "Spec")}</strong>: ${esc(row.specValue)}`),
    "No detailed specifications found."
  );
  renderList(
    els.drawerColors,
    colors.map((row) => {
      const storage = [row.capacity, row.unit].filter(Boolean).join(" ");
      const stock = row.available === false ? "Not available" : `Available${row.qty !== "" && row.qty != null ? `, qty ${row.qty}` : ""}`;
      const price = row.standalonePrice ? `, standalone ${row.standalonePrice}` : "";
      return `
        <strong>${esc(storage || "-")} / ${esc(row.colorName || "-")}</strong>
        <span>Item code: ${esc(row.itemCode || "-")}</span>
        <span>${esc(stock + price)}</span>
      `;
    }),
    "No color/SKU rows found."
  );
  renderList(
    els.drawerPlans,
    [
      ...plans.slice(0, 10).map((row) => `<strong>${esc(row.offerName || "Plan")}</strong>: ${esc(row.commitment || row.price || row.monthlyPrice || "-")}`),
      ...zeed.slice(0, 10).map((row) => `<strong>Zeed</strong>: ${esc(row.commitment || row.monthlyPrice || row.price || "-")}`)
    ],
    "No plan or Zeed offers found."
  );

  els.drawerLink.href = device.productUrl || "#";
  els.drawerLink.hidden = !device.productUrl;
  els.drawer.classList.add("open");
}

async function loadData() {
  setLoading(true);
  setStatus("Fetching live data from STC...", "busy");
  try {
    const response = await fetch(apiUrl("/api/live-data"));
    if (!response.ok) throw new Error(`Live fetch failed: ${response.status}`);
    state.data = await response.json();
    state.filtered = state.data.devices || [];
    updateMetrics();
    populateFilters();
    applyFilters();
    if (state.data.fetchWarning) {
      setStatus(`Showing last saved snapshot: ${state.data.fetchWarning}`, "error");
    } else {
      const removed = state.data.changeSummary?.removed || 0;
      setStatus(`Live data loaded: ${state.data.changeSummary?.currentTotal || state.data.devices.length} current devices, ${removed} removed tracked`, "ok");
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Unable to fetch live data", "error");
  } finally {
    setLoading(false);
  }
}

els.refreshBtn.addEventListener("click", loadData);
els.searchInput.addEventListener("input", applyFilters);
els.statusFilter.addEventListener("change", applyFilters);
els.categoryFilter.addEventListener("change", applyFilters);
els.brandFilter.addEventListener("change", applyFilters);
els.tableBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-index]");
  if (row) openDrawer(state.filtered[Number(row.dataset.index)]);
});
els.tableBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const row = event.target.closest("tr[data-index]");
  if (row) openDrawer(state.filtered[Number(row.dataset.index)]);
});
els.closeDrawer.addEventListener("click", () => els.drawer.classList.remove("open"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") els.drawer.classList.remove("open");
});
els.downloadBtn.href = apiUrl("/api/download-report");
els.downloadBtn.addEventListener("click", () => setStatus("Preparing a fresh Excel download...", "busy"));

loadData();
