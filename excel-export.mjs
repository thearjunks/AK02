import ExcelJS from "exceljs";
import { compareDevicesByAddition, deviceLifecycleStatus } from "./public/device-order.js";

function addSheet(workbook, name, rows, columns) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });

  sheet.columns = columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(10, Math.round((column.widthPx || 140) / 8)),
  }));

  for (const row of rows || []) {
    sheet.addRow(row);
  }

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F008C" } };
  header.alignment = { vertical: "middle", wrapText: true };

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9D9D9" } },
        left: { style: "thin", color: { argb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
        right: { style: "thin", color: { argb: "FFD9D9D9" } },
      };
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  if (rows?.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }
}

function excelStatus(device) {
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

export async function buildStockExcel(data, filters = {}) {
  const currentDevices = (data.devices || []).filter((device) => excelStatus(device) !== "REMOVED");
  const deviceByGroup = new Map(currentDevices.map((device) => [device.itemGroup, device]));
  const colorRows = (data.colors || []).filter((row) => deviceByGroup.has(row.itemGroup));
  const groupsWithColor = new Set(colorRows.map((row) => row.itemGroup));
  const fallbackRows = currentDevices
    .filter((device) => !groupsWithColor.has(device.itemGroup))
    .map((device) => ({ itemGroup: device.itemGroup, model: device.deviceName, itemCode: device.defaultItemCode }));
  const search = String(filters.search || "").trim().toLowerCase();

  const rows = [...colorRows, ...fallbackRows]
    .map((row) => {
      const device = deviceByGroup.get(row.itemGroup) || {};
      return {
        availabilityStatus: stockStatus(row),
        stock: row.qty ?? "",
        brand: device.brand || "",
        category: device.category || "",
        deviceName: device.deviceName || row.model || "",
        itemGroup: row.itemGroup || "",
        itemCode: row.itemCode || "",
        storage: storageLabel(row),
        colorName: row.colorName || "",
        preorder: row.preorder === true ? "YES" : "NO",
        standalonePrice: row.standalonePrice || "",
        deviceUrl: device.productUrl || "",
      };
    })
    .filter((row) => {
      const haystack = Object.values(row).join(" ").toLowerCase();
      return (!search || haystack.includes(search)) &&
        (!filters.availability || row.availabilityStatus === filters.availability) &&
        (!filters.brand || row.brand === filters.brand) &&
        (!filters.category || row.category === filters.category);
    })
    .map((row, index) => ({ no: index + 1, ...row }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "STC Kuwait Stock Management Board";
  workbook.created = new Date();
  addSheet(workbook, "Stock", rows, [
    { key: "no", label: "No.", widthPx: 55 },
    { key: "availabilityStatus", label: "Availability Status", widthPx: 145 },
    { key: "stock", label: "Stock", widthPx: 80 },
    { key: "brand", label: "Brand", widthPx: 120 },
    { key: "category", label: "Category", widthPx: 120 },
    { key: "deviceName", label: "Device Name", widthPx: 190 },
    { key: "itemGroup", label: "Item Group", widthPx: 230 },
    { key: "itemCode", label: "Item Code", widthPx: 250 },
    { key: "storage", label: "Storage", widthPx: 110 },
    { key: "colorName", label: "Color Name", widthPx: 150 },
    { key: "preorder", label: "Preorder", widthPx: 90 },
    { key: "standalonePrice", label: "Standalone Price", widthPx: 130 },
    { key: "deviceUrl", label: "Device URL", widthPx: 320 },
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildExcel(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "STC Kuwait Live Device Dashboard";
  workbook.created = new Date();
  workbook.modified = new Date();
  const devicesForExcel = [...(data.devices || [])].sort(compareDevicesByAddition).map((device) => ({
    ...device,
    excelStatus: excelStatus(device),
  }));
  const liveCount = devicesForExcel.filter((device) => device.excelStatus === "EXISTING").length;
  const addedCount = devicesForExcel.filter((device) => device.excelStatus === "NEW").length;
  const removedCount = devicesForExcel.filter((device) => device.excelStatus === "REMOVED").length;

  const summaryRows = [
    { metric: "EXISTING devices", value: liveCount, notes: "Current devices first seen more than 15 days ago" },
    { metric: "NEW devices", value: addedCount, notes: "Current devices first seen during the last 15 days" },
    { metric: "REMOVED devices", value: removedCount, notes: "Previously seen devices missing from the latest STC data" },
    { metric: "Displayed devices", value: devicesForExcel.length, notes: "NEW + EXISTING + REMOVED devices in the report" },
    { metric: "Color / SKU rows", value: data.colors.length, notes: "Color, capacity, item-code combinations" },
    { metric: "Specification rows", value: data.specs.length, notes: "Device Specs from detail pages" },
    { metric: "Plan offer rows", value: data.plans.length, notes: "Default available item code per product" },
    { metric: "Zeed offer rows", value: data.zeed.length, notes: "Default available item code per product" },
    { metric: "Extraction notes", value: data.errors.length, notes: "Missing item codes or endpoint issues" },
    { metric: "Generated at", value: data.generatedAt, notes: "Live fetch timestamp" },
  ];

  addSheet(workbook, "Summary", summaryRows, [
    { key: "metric", label: "Metric", widthPx: 240 },
    { key: "value", label: "Value", widthPx: 280 },
    { key: "notes", label: "Notes", widthPx: 420 },
  ]);

  addSheet(workbook, "Devices", devicesForExcel, [
    { key: "no", label: "No.", widthPx: 55 },
    { key: "excelStatus", label: "Status", widthPx: 110 },
    { key: "deviceStatus", label: "Internal status", widthPx: 115 },
    { key: "label", label: "Label", widthPx: 80 },
    { key: "category", label: "Category", widthPx: 120 },
    { key: "brand", label: "Brand", widthPx: 120 },
    { key: "deviceName", label: "Device name", widthPx: 190 },
    { key: "itemGroup", label: "Item group", widthPx: 230 },
    { key: "productUrl", label: "Product URL", widthPx: 310 },
    { key: "cardStartingPriceText", label: "Grid starting price text", widthPx: 160 },
    { key: "cardZeedPriceText", label: "Grid Zeed price text", widthPx: 150 },
    { key: "cardCashPriceText", label: "Grid cash price text", widthPx: 150 },
    { key: "cashOfferPrice", label: "Detail cash offer price", widthPx: 130 },
    { key: "zeedLowest24Month", label: "Zeed 24 months", widthPx: 120 },
    { key: "zeedLowest36Month", label: "Zeed 36 months", widthPx: 120 },
    { key: "planOfferCount", label: "Plan offer count", widthPx: 120 },
    { key: "storageOptions", label: "Storage options", widthPx: 190 },
    { key: "colorNames", label: "Colors", widthPx: 260 },
    { key: "productDescription", label: "Product description", widthPx: 420 },
    { key: "display", label: "Display", widthPx: 100 },
    { key: "processorChip", label: "Processor Chip", widthPx: 190 },
    { key: "primaryCameraRear", label: "Primary Camera (Rear)", widthPx: 190 },
    { key: "selfieCameraFront", label: "Selfie Camera (Front)", widthPx: 160 },
    { key: "battery", label: "Battery", widthPx: 220 },
    { key: "networkType", label: "Network Type", widthPx: 110 },
    { key: "defaultItemCode", label: "Default item code", widthPx: 240 },
    { key: "firstSeenAt", label: "Added Date", widthPx: 170 },
    { key: "lastSeenAt", label: "Last seen at", widthPx: 170 },
    { key: "removedAt", label: "Removed at", widthPx: 170 },
    { key: "firstImageUrl", label: "First image URL", widthPx: 320 },
  ]);

  addSheet(workbook, "Colors_SKUs", data.colors, [
    { key: "itemGroup", label: "Item group", widthPx: 230 },
    { key: "model", label: "Device name", widthPx: 190 },
    { key: "capacity", label: "Capacity", widthPx: 100 },
    { key: "unit", label: "Unit", widthPx: 80 },
    { key: "itemCode", label: "Item code", widthPx: 260 },
    { key: "colorName", label: "Color name", widthPx: 160 },
    { key: "colorCode", label: "Color code", widthPx: 120 },
    { key: "available", label: "Available", widthPx: 90 },
    { key: "preorder", label: "Preorder", widthPx: 90 },
    { key: "qty", label: "Quantity", widthPx: 90 },
    { key: "standalonePrice", label: "Standalone price", widthPx: 130 },
    { key: "imageUrl", label: "Image URL", widthPx: 320 },
  ]);

  addSheet(workbook, "Specs", data.specs, [
    { key: "itemGroup", label: "Item group", widthPx: 230 },
    { key: "model", label: "Device name", widthPx: 190 },
    { key: "specTitle", label: "Spec title", widthPx: 210 },
    { key: "specValue", label: "Spec value", widthPx: 320 },
  ]);

  addSheet(workbook, "Plan_Offers", data.plans, [
    { key: "itemGroup", label: "Item group", widthPx: 230 },
    { key: "model", label: "Device name", widthPx: 190 },
    { key: "itemCode", label: "Item code", widthPx: 250 },
    { key: "planName", label: "Plan name", widthPx: 170 },
    { key: "period", label: "Period", widthPx: 80 },
    { key: "deviceRent", label: "Device rent", widthPx: 110 },
    { key: "parentPlanPrice", label: "Parent plan price", widthPx: 130 },
    { key: "currency", label: "Currency", widthPx: 90 },
    { key: "commitmentDescription", label: "Commitment description", widthPx: 260 },
    { key: "benefits", label: "Benefits", widthPx: 520 },
  ]);

  addSheet(workbook, "Zeed_Offers", data.zeed, [
    { key: "itemGroup", label: "Item group", widthPx: 230 },
    { key: "model", label: "Device name", widthPx: 190 },
    { key: "itemCode", label: "Item code", widthPx: 250 },
    { key: "period", label: "Period", widthPx: 80 },
    { key: "deviceRent", label: "Device rent", widthPx: 110 },
    { key: "currency", label: "Currency", widthPx: 90 },
    { key: "commitmentDescription", label: "Commitment description", widthPx: 260 },
    { key: "parentPlan", label: "Parent plan", widthPx: 230 },
  ]);

  addSheet(workbook, "Extraction_Notes", data.errors, [
    { key: "itemGroup", label: "Item group", widthPx: 230 },
    { key: "key", label: "Detail API key", widthPx: 260 },
    { key: "stage", label: "Stage", widthPx: 120 },
    { key: "status", label: "Status", widthPx: 120 },
    { key: "message", label: "Message", widthPx: 430 },
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
