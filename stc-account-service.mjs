import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const credentialsPath = path.join(dataDir, "account-credentials.enc.json");
const accountDataPath = path.join(dataDir, "account-device-data.json");
const STC_BASE = "https://digitalapi-gateway.stc.com.kw";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEADERS = {
  channel: "WEB",
  locale: "en",
  "Accept-Language": "en",
  "User-Agent": "Mozilla/5.0",
};

let encryptionKey = null;
let accountData = { generatedAt: null, accounts: [] };

export function normalizeMsisdn(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00965")) digits = digits.slice(5);
  if (digits.startsWith("965") && digits.length === 11) digits = digits.slice(3);
  if (!/^\d{8}$/.test(digits)) throw new Error("Enter a valid 8-digit Kuwait MSISDN.");
  return digits;
}

export function configureAccountService(secret) {
  if (!secret) throw new Error("Account credential encryption is not configured.");
  encryptionKey = crypto.createHash("sha256").update(String(secret)).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decrypt(payload) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

async function readCredentials() {
  try {
    return decrypt(JSON.parse(await fs.readFile(credentialsPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Saved STC credentials could not be decrypted. Re-add the accounts.");
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(dataDir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2));
  await fs.rename(tempPath, filePath);
}

async function writeCredentials(accounts) {
  await writeJsonAtomic(credentialsPath, encrypt(accounts));
}

async function saveAccountData() {
  accountData.generatedAt = new Date().toISOString();
  await writeJsonAtomic(accountDataPath, accountData);
}

export async function loadAccountData() {
  try {
    accountData = JSON.parse(await fs.readFile(accountDataPath, "utf8"));
  } catch {
    accountData = { generatedAt: null, accounts: [] };
  }
  return publicAccountData();
}

async function stcRequest(pathname, { method = "GET", body, authCode = "" } = {}) {
  const tokenResponse = await fetch(`${STC_BASE}/ClientCred/v1`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!tokenResponse.ok) throw new Error(`STC authentication service returned HTTP ${tokenResponse.status}.`);
  const token = await tokenResponse.json();
  const headers = {
    ...DEFAULT_HEADERS,
    Authorization: `${token.token_type} ${token.access_token}`,
  };
  if (authCode) headers.authCode = authCode;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${STC_BASE}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { message: raw }; }
  if (!response.ok || (payload.statusCode != null && Number(payload.statusCode) !== 0)) {
    const message = payload.errorMessage || payload.message || `HTTP ${response.status}`;
    throw new Error(`STC connection failed: ${message}`);
  }
  return payload;
}

function normalizeDevice(device) {
  return {
    productId: String(device.productId || device.itemGroup || device.title || "").trim(),
    title: String(device.title || "").trim(),
    brand: String(device.subTitle || device.brand || "").trim(),
    itemType: String(device.itemType || "").trim(),
    available: device.available === true,
    quantity: device.quantity ?? "",
    startingPrice: device.startingPrice ?? "",
    retailPrice: device.retailPrice ?? "",
    zeedPrice: device.zeedPrice ?? "",
    currency: String(device.currency || "KWD").trim(),
    imageUrl: String(device.thumbUrl || "").trim(),
  };
}

async function fetchAccount(msisdn, password) {
  const login = await stcRequest("/b2cUSER_loginViaPassword/v3", {
    method: "POST",
    body: {
      userName: msisdn,
      subscriberNumber: msisdn,
      password,
      loginType: "PASSWORD",
      requestedFrom: "WEB",
    },
  });
  if (!login.authToken) throw new Error("STC connection failed: no authenticated session was returned.");

  const [profileResponse, devicesResponse] = await Promise.all([
    stcRequest(`/dig-getCustomerProfile/v3/${encodeURIComponent(msisdn)}`, { authCode: login.authToken }),
    stcRequest("/dig-getAllDevices/v1/SELFCARE?itemType=", { authCode: login.authToken }),
  ]);
  const profile = profileResponse.data || profileResponse;
  const devices = Array.isArray(devicesResponse.data) ? devicesResponse.data.map(normalizeDevice) : [];
  if (!devices.length) throw new Error("STC connected, but the Selfcare device feed returned no devices.");
  return {
    msisdn,
    status: "CONNECTED",
    message: "Connected Successfully",
    displayName: String(profile.fullName || "").trim(),
    subscriberNumber: String(profile.subscriberNumber || msisdn).trim(),
    lastFetchedAt: new Date().toISOString(),
    deviceCount: devices.length,
    devices: [...new Map(devices.map((device) => [device.productId || `${device.itemType}:${device.title}`, device])).values()],
  };
}

function failedAccount(msisdn, error, previous = {}) {
  return {
    ...previous,
    msisdn,
    status: "FAILED",
    message: error.message || "STC connection failed.",
    lastAttemptedAt: new Date().toISOString(),
    devices: previous.devices || [],
    deviceCount: previous.devices?.length || 0,
  };
}

export async function connectStcAccount(msisdnValue, passwordValue) {
  const msisdn = normalizeMsisdn(msisdnValue);
  const password = String(passwordValue || "");
  if (!password) throw new Error("Password is required.");
  const previous = accountData.accounts.find((account) => account.msisdn === msisdn) || {};
  try {
    const connected = await fetchAccount(msisdn, password);
    const credentials = await readCredentials();
    const nextCredentials = credentials.filter((account) => account.msisdn !== msisdn);
    nextCredentials.push({ msisdn, password });
    await writeCredentials(nextCredentials);
    accountData.accounts = [...accountData.accounts.filter((account) => account.msisdn !== msisdn), connected];
    await saveAccountData();
    return publicAccountData();
  } catch (error) {
    accountData.accounts = [...accountData.accounts.filter((account) => account.msisdn !== msisdn), failedAccount(msisdn, error, previous)];
    await saveAccountData();
    throw error;
  }
}

export async function refreshStcAccounts(msisdnValue = "") {
  const credentials = await readCredentials();
  const requested = msisdnValue ? normalizeMsisdn(msisdnValue) : "";
  const selected = requested ? credentials.filter((account) => account.msisdn === requested) : credentials;
  if (!selected.length) throw new Error(requested ? "No saved credentials were found for this MSISDN." : "Add an STC account first.");
  for (const credential of selected) {
    const previous = accountData.accounts.find((account) => account.msisdn === credential.msisdn) || {};
    try {
      const connected = await fetchAccount(credential.msisdn, credential.password);
      accountData.accounts = [...accountData.accounts.filter((account) => account.msisdn !== credential.msisdn), connected];
    } catch (error) {
      accountData.accounts = [...accountData.accounts.filter((account) => account.msisdn !== credential.msisdn), failedAccount(credential.msisdn, error, previous)];
    }
  }
  await saveAccountData();
  return publicAccountData();
}

export async function removeStcAccount(msisdnValue) {
  const msisdn = normalizeMsisdn(msisdnValue);
  await writeCredentials((await readCredentials()).filter((account) => account.msisdn !== msisdn));
  accountData.accounts = accountData.accounts.filter((account) => account.msisdn !== msisdn);
  await saveAccountData();
  return publicAccountData();
}

export function deduplicateAccountDevices(accounts) {
  const merged = new Map();
  for (const account of accounts) {
    for (const device of account.devices || []) {
      const key = device.productId || `${device.itemType}:${device.title}`;
      const current = merged.get(key) || { ...device, accountMsisdns: [], accountValues: [] };
      current.available = current.available || device.available;
      current.accountMsisdns.push(account.msisdn);
      current.accountValues.push({
        msisdn: account.msisdn,
        available: device.available,
        quantity: device.quantity,
        startingPrice: device.startingPrice,
        retailPrice: device.retailPrice,
        zeedPrice: device.zeedPrice,
      });
      merged.set(key, current);
    }
  }
  return [...merged.values()].map((device) => ({
    ...device,
    accountMsisdns: [...new Set(device.accountMsisdns)].sort(),
  }));
}

export function publicAccountData() {
  const accounts = accountData.accounts.map((account) => ({ ...account, devices: account.devices || [] }));
  return {
    generatedAt: accountData.generatedAt,
    accounts,
    devices: deduplicateAccountDevices(accounts),
  };
}
