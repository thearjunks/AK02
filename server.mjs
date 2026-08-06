import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildExcel, buildStockExcel } from "./excel-export.mjs";
import { fetchStcDevices } from "./stc-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const snapshotPath = path.join(dataDir, "latest-snapshot.json");
const deploymentPath = path.join(__dirname, "deployment.json");
const authConfigPath = path.join(__dirname, "auth-config.json");
const authCookieName = "stc_dashboard_session";
const sessionLifetimeMs = 12 * 60 * 60 * 1000;

let lastData = null;
let authConfig = null;

function deviceKey(device) {
  return device?.detailApiKey || device?.productUrl || device?.itemGroup || `${device?.category || ""}:${device?.deviceName || ""}`;
}

async function readPreviousSnapshot() {
  try {
    return JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  } catch {
    return null;
  }
}

export async function loadSavedData() {
  authConfig = await loadAuthConfig();
  lastData = await readPreviousSnapshot();
  return lastData;
}

async function loadAuthConfig() {
  let privateConfig = {};
  try {
    privateConfig = JSON.parse(await fs.readFile(authConfigPath, "utf8"));
  } catch {
    privateConfig = {};
  }
  const config = {
    username: process.env.DASHBOARD_USERNAME || privateConfig.username,
    password: process.env.DASHBOARD_PASSWORD || privateConfig.password,
    sessionSecret: process.env.SESSION_SECRET || privateConfig.sessionSecret,
  };
  if (!config.username || !config.password || !config.sessionSecret) {
    throw new Error("Dashboard authentication is not configured.");
  }
  return config;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(expiresAt) {
  const payload = Buffer.from(JSON.stringify({ username: authConfig.username, expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", authConfig.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function validSession(request) {
  const cookies = Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? [part.trim(), ""] : [part.slice(0, separator).trim(), part.slice(separator + 1)];
  }));
  const token = cookies[authCookieName];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = crypto.createHmac("sha256", authConfig.sessionSecret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.username === authConfig.username && Number(session.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function secureRequest(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  const host = String(request.headers.host || "").toLowerCase();
  return forwardedProto === "https" || (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

function sendRedirect(response, location, cookie = "") {
  const headers = { Location: location, "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  response.writeHead(302, headers);
  response.end();
}

function loginPage(errorMessage = "", nextPath = "/all-devices") {
  const error = errorMessage ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>` : "";
  const action = `/login?next=${encodeURIComponent(nextPath)}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in | STC Device Operations</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f4f5f7;color:#20262e;font-family:Inter,"Segoe UI",Arial,sans-serif}.login{width:min(390px,100%);padding:28px;border:1px solid #dfe3e8;border-radius:8px;background:#fff;box-shadow:0 14px 35px rgba(32,38,46,.1)}.brand{display:flex;align-items:center;gap:10px;margin-bottom:26px;font-weight:800}.mark{display:grid;width:44px;height:38px;place-items:center;border-radius:5px;background:#4f008c;color:#fff;font-size:20px}h1{margin:0;font-size:24px;letter-spacing:0}p{margin:7px 0 22px;color:#6c7683;font-size:14px}.field{display:grid;gap:6px;margin:0 0 15px}.field span{color:#59636f;font-size:12px;font-weight:800}input{width:100%;height:44px;padding:0 12px;border:1px solid #cbd1d8;border-radius:6px;font:inherit}input:focus{border-color:#4f008c;outline:2px solid #eadcf3}button{width:100%;height:44px;border:0;border-radius:6px;background:#4f008c;color:#fff;font:inherit;font-weight:800;cursor:pointer}.error{margin:-4px 0 15px;padding:10px;border-left:3px solid #b42318;background:#fdecec;color:#b42318;font-size:13px}
  </style>
</head>
<body>
  <main class="login">
    <div class="brand"><span class="mark">stc</span><span>Device Operations</span></div>
    <h1>Sign in</h1>
    <p>Enter your authorized dashboard credentials.</p>
    ${error}
    <form method="post" action="${action}">
      <label class="field"><span>Username</span><input name="username" autocomplete="username" required autofocus /></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function sendLoginPage(response, errorMessage = "", nextPath = "/all-devices", status = 200) {
  const body = loginPage(errorMessage, nextPath);
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Login request is too large.");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function safeNextPath(value) {
  const nextPath = String(value || "");
  return nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/all-devices";
}

function mergeRowsForRemoved(currentRows, previousRows, removedItemGroups) {
  const existing = new Set(currentRows.map((row) => `${row.itemGroup}:${row.itemCode || row.specTitle || row.imageUrl || row.capacity || ""}`));
  const restored = [];
  for (const row of previousRows || []) {
    if (!removedItemGroups.has(row.itemGroup)) continue;
    const key = `${row.itemGroup}:${row.itemCode || row.specTitle || row.imageUrl || row.capacity || ""}`;
    if (!existing.has(key)) restored.push(row);
  }
  return [...currentRows, ...restored];
}

async function applyHistory(rawData) {
  const previous = await readPreviousSnapshot();
  const fetchedAt = rawData.generatedAt || new Date().toISOString();
  const previousByKey = new Map();
  for (const device of previous?.devices || []) {
    const key = deviceKey(device);
    const prior = previousByKey.get(key);
    if (!prior) previousByKey.set(key, { ...device });
    else if (Date.parse(device.firstSeenAt || "") < Date.parse(prior.firstSeenAt || "")) prior.firstSeenAt = device.firstSeenAt;
  }
  const previousDevices = [...previousByKey.values()];
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

  const removedItemGroups = new Set(removedDevices.map((device) => device.itemGroup));
  const data = {
    ...rawData,
    devices: [...mergedDevices, ...removedDevices],
    colors: mergeRowsForRemoved(rawData.colors || [], previous?.colors || [], removedItemGroups),
    capacities: mergeRowsForRemoved(rawData.capacities || [], previous?.capacities || [], removedItemGroups),
    specs: mergeRowsForRemoved(rawData.specs || [], previous?.specs || [], removedItemGroups),
    images: mergeRowsForRemoved(rawData.images || [], previous?.images || [], removedItemGroups),
    plans: mergeRowsForRemoved(rawData.plans || [], previous?.plans || [], removedItemGroups),
    zeed: mergeRowsForRemoved(rawData.zeed || [], previous?.zeed || [], removedItemGroups),
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

export async function refreshLiveData() {
  return applyHistory(await fetchStcDevices());
}

const fetchWithHistory = refreshLiveData;

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
    refreshAttemptedAt: new Date().toISOString(),
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readDeploymentInfo() {
  try {
    return JSON.parse(await fs.readFile(deploymentPath, "utf8"));
  } catch {
    return { deploymentId: "unknown", createdAt: null };
  }
}

function filenameStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const dashboardRoutes = new Set(["/", "/all-devices", "/stock", "/zed-prices", "/content", "/plans", "/device-master"]);
  const pathname = dashboardRoutes.has(url.pathname.replace(/\/$/, "") || "/") ? "/index.html" : url.pathname;
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
    response.writeHead(200, {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "no-cache",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

export async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/health" || url.pathname === "/api/health") {
      const deployment = await readDeploymentInfo();
      sendJson(response, 200, {
        status: "ok",
        service: "stc-kuwait-live-device-dashboard",
        ...deployment,
        cachedDataLoaded: Boolean(lastData),
        cachedDataGeneratedAt: lastData?.generatedAt || null,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (url.pathname === "/login" && request.method === "GET") {
      if (validSession(request)) {
        sendRedirect(response, safeNextPath(url.searchParams.get("next")));
      } else {
        sendLoginPage(response, "", safeNextPath(url.searchParams.get("next")));
      }
      return;
    }
    if (url.pathname === "/login" && request.method === "POST") {
      const form = await readForm(request);
      const username = form.get("username") || "";
      const password = form.get("password") || "";
      const nextPath = safeNextPath(url.searchParams.get("next"));
      if (!safeEqual(username, authConfig.username) || !safeEqual(password, authConfig.password)) {
        sendLoginPage(response, "Incorrect username or password.", nextPath, 401);
        return;
      }
      const expiresAt = Date.now() + sessionLifetimeMs;
      const secure = secureRequest(request) ? "; Secure" : "";
      const cookie = `${authCookieName}=${signSession(expiresAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure}`;
      sendRedirect(response, nextPath, cookie);
      return;
    }
    if (url.pathname === "/logout" && request.method === "POST") {
      const secure = secureRequest(request) ? "; Secure" : "";
      sendRedirect(response, "/login", `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
      return;
    }
    if (!validSession(request)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 401, { error: "Authentication required." });
      } else if (url.pathname === "/styles.css" || url.pathname === "/app.js") {
        response.writeHead(404);
        response.end("Not found");
      } else {
        sendRedirect(response, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      }
      return;
    }
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
    if (url.pathname === "/api/download-board" && url.searchParams.get("board") === "stock") {
      const data = lastData || await readPreviousSnapshot();
      if (!data) throw new Error("No saved device data is available for export.");
      const workbook = await buildStockExcel(data, {
        search: url.searchParams.get("search") || "",
        availability: url.searchParams.get("availability") || "",
        brand: url.searchParams.get("brand") || "",
        category: url.searchParams.get("category") || "",
      });
      response.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="stc_stock_${filenameStamp()}.xlsx"`,
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
}
