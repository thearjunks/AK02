import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExcel } from "./excel-export.mjs";
import { fetchStcDevices } from "./stc-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const snapshotPath = path.join(dataDir, "latest-snapshot.json");
const port = Number(process.env.PORT || 4177);

let lastData = null;

function deviceKey(device) {
  return device?.itemGroup || device?.detailApiKey || device?.productUrl || `${device?.category || ""}:${device?.deviceName || ""}`;
}

async function readPreviousSnapshot() {
  try {
    return JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  } catch {
    return null;
  }
}

function mergeRowsForRemoved(currentRows, previousRows, removedKeys) {
  const existing = new Set(currentRows.map((row) => `${deviceKey(row)}:${row.itemCode || row.specTitle || row.imageUrl || row.capacity || ""}`));
  const restored = [];
  for (const row of previousRows || []) {
    if (!removedKeys.has(deviceKey(row))) continue;
    const key = `${deviceKey(row)}:${row.itemCode || row.specTitle || row.imageUrl || row.capacity || ""}`;
    if (!existing.has(key)) restored.push(row);
  }
  return [...currentRows, ...restored];
}

async function applyHistory(rawData) {
  const previous = await readPreviousSnapshot();
  const fetchedAt = rawData.generatedAt || new Date().toISOString();
  const previousDevices = previous?.devices || [];
  const previousByKey = new Map(previousDevices.map((device) => [deviceKey(device), device]));
  const currentKeys = new Set(rawData.devices.map(deviceKey));
  const mergedDevices = rawData.devices.map((device) => {
    const key = deviceKey(device);
    const prior = previousByKey.get(key);
    let deviceStatus = "ACTIVE";
    if (!prior) deviceStatus = previous ? "ADDED" : "ACTIVE";
    if (prior?.deviceStatus === "REMOVED") deviceStatus = "ADDED";
    if (prior?.deviceStatus === "ADDED" || prior?.deviceStatus === "RESTORED") deviceStatus = "ADDED";
    return {
      ...device,
      deviceStatus,
      firstSeenAt: prior?.firstSeenAt || fetchedAt,
      addedAt: deviceStatus === "ADDED" ? (prior?.addedAt || fetchedAt) : "",
      lastSeenAt: fetchedAt,
      removedAt: "",
    };
  });

  const removedDevices = previousDevices
    .filter((device) => !currentKeys.has(deviceKey(device)))
    .map((device) => ({
      ...device,
      deviceStatus: "REMOVED",
      addedAt: device.addedAt || "",
      removedAt: device.removedAt || fetchedAt,
      lastSeenAt: device.lastSeenAt || previous?.generatedAt || "",
    }));

  const removedKeys = new Set(removedDevices.map(deviceKey));
  const data = {
    ...rawData,
    devices: [...mergedDevices, ...removedDevices],
    colors: mergeRowsForRemoved(rawData.colors || [], previous?.colors || [], removedKeys),
    capacities: mergeRowsForRemoved(rawData.capacities || [], previous?.capacities || [], removedKeys),
    specs: mergeRowsForRemoved(rawData.specs || [], previous?.specs || [], removedKeys),
    images: mergeRowsForRemoved(rawData.images || [], previous?.images || [], removedKeys),
    plans: mergeRowsForRemoved(rawData.plans || [], previous?.plans || [], removedKeys),
    zeed: mergeRowsForRemoved(rawData.zeed || [], previous?.zeed || [], removedKeys),
    changeSummary: {
      active: mergedDevices.filter((device) => device.deviceStatus === "ACTIVE").length,
      added: mergedDevices.filter((device) => device.deviceStatus === "ADDED").length,
      restored: 0,
      removed: removedDevices.length,
      currentTotal: rawData.devices.length,
      displayedTotal: mergedDevices.length + removedDevices.length,
    },
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(snapshotPath, JSON.stringify(data, null, 2));
  return data;
}

async function fetchWithHistory() {
  return applyHistory(await fetchStcDevices());
}

function showRestoredAsAdded(data) {
  const devices = (data.devices || []).map((device) => (
    device.deviceStatus === "RESTORED" ? { ...device, deviceStatus: "ADDED" } : device
  ));
  const addedFromRestored = (data.devices || []).filter((device) => device.deviceStatus === "RESTORED").length;
  return {
    ...data,
    devices,
    changeSummary: {
      ...(data.changeSummary || {}),
      added: (data.changeSummary?.added || 0) + addedFromRestored,
      restored: 0,
    },
  };
}

async function snapshotWithWarning(error) {
  const previous = await readPreviousSnapshot();
  if (!previous) throw error;
  return showRestoredAsAdded({
    ...previous,
    fetchWarning: error.message || "Live refresh failed; showing the last saved snapshot.",
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function filenameStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === "/api/live-data") {
      try {
        lastData = await fetchWithHistory();
      } catch (error) {
        console.error(error);
        lastData = await snapshotWithWarning(error);
      }
      sendJson(response, 200, lastData);
      return;
    }
    if (url.pathname === "/api/download-report") {
      let data;
      try {
        data = await fetchWithHistory();
      } catch (error) {
        console.error(error);
        data = await snapshotWithWarning(error);
      }
      lastData = data;
      const workbook = await buildExcel(data);
      response.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="stc_kuwait_live_devices_${filenameStamp()}.xlsx"`,
        "Content-Length": workbook.length,
        "Cache-Control": "no-store",
      });
      response.end(workbook);
      return;
    }
    if (url.pathname === "/api/cached-data") {
      sendJson(response, 200, lastData || { devices: [], generatedAt: null });
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`STC dashboard running at http://localhost:${port}`);
});
