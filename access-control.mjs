import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scrypt = promisify(crypto.scrypt);
const DEFAULT_DATA_PATH = path.join(__dirname, "data", "access-control.json");

export const DASHBOARDS = ["all", "stock", "zed", "content", "removed", "plans", "master", "accounts"];
export const DASHBOARD_ROUTES = {
  all: "/all-devices",
  stock: "/stock",
  zed: "/zed-prices",
  content: "/content",
  removed: "/removed-devices",
  plans: "/plans",
  master: "/device-master",
  accounts: "/account-devices",
};

let dataPath = DEFAULT_DATA_PATH;
let state = { version: 1, users: [], requests: [] };

function text(value, max = 200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeUsername(value) {
  const username = text(value, 64);
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) throw new Error("Username must be 3-64 letters, numbers, dots, underscores, or hyphens.");
  return username;
}

function normalizeMobile(value) {
  let mobile = String(value || "").replace(/\D/g, "");
  if (mobile.startsWith("00965")) mobile = mobile.slice(5);
  if (mobile.startsWith("965") && mobile.length === 11) mobile = mobile.slice(3);
  if (!/^\d{8}$/.test(mobile)) throw new Error("Enter a valid 8-digit Kuwait mobile number.");
  return mobile;
}

function normalizeEmail(value) {
  const email = text(value, 160).toLowerCase();
  if (!/^[^\s@]+@(?:[a-z0-9-]+\.)*stc\.com\.kw$/i.test(email)) throw new Error("Enter a valid STC email ID ending in stc.com.kw.");
  return email;
}

function normalizeDepartment(value) {
  const department = text(value, 80);
  if (department.length < 2) throw new Error("Department is required.");
  return department;
}

function normalizePermissions(value = {}) {
  const dashboards = [...new Set((Array.isArray(value.dashboards) ? value.dashboards : []).filter((name) => DASHBOARDS.includes(name)))];
  return { dashboards, canEmail: value.canEmail === true, canDownload: value.canDownload === true };
}

async function passwordHash(password) {
  if (String(password || "").length < 5) throw new Error("Password must contain at least 5 characters.");
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

async function passwordMatches(password, stored) {
  const [algorithm, saltValue, hashValue] = String(stored || "").split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64");
  const actual = await scrypt(String(password || ""), Buffer.from(saltValue, "base64"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function save() {
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  const temporary = `${dataPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2));
  await fs.rename(temporary, dataPath);
}

export async function loadAccessControl({ adminUsername, adminPassword, storagePath } = {}) {
  dataPath = storagePath || process.env.RBAC_DATA_PATH || DEFAULT_DATA_PATH;
  try {
    state = JSON.parse(await fs.readFile(dataPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { version: 1, users: [], requests: [] };
  }
  state.users ||= [];
  state.requests ||= [];
  const username = normalizeUsername(adminUsername || "arjun.sajimon");
  let admin = state.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
  if (!admin) {
    admin = {
      id: crypto.randomUUID(),
      username,
      mobile: "",
      department: "Administration",
      email: "",
      role: "ADMIN",
      active: true,
      passwordHash: await passwordHash(adminPassword),
      permissions: { dashboards: [...DASHBOARDS], canEmail: true, canDownload: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.users.push(admin);
    await save();
  }
  return admin;
}

export function effectivePermissions(user) {
  if (user?.role === "ADMIN") return { dashboards: [...DASHBOARDS], canEmail: true, canDownload: true };
  return normalizePermissions(user?.permissions);
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash: _passwordHash, ...result } = user;
  return { ...result, permissions: effectivePermissions(user) };
}

export async function authenticateUser(usernameValue, password) {
  const username = text(usernameValue, 64).toLowerCase();
  const user = state.users.find((candidate) => candidate.username.toLowerCase() === username);
  if (!user || !user.active || !(await passwordMatches(password, user.passwordHash))) return null;
  return safeUser(user);
}

export function findUserById(id) {
  return safeUser(state.users.find((user) => user.id === id && user.active));
}

export function canAccessDashboard(user, dashboard) {
  return Boolean(user && effectivePermissions(user).dashboards.includes(dashboard));
}

export function defaultRouteFor(user) {
  if (user?.role === "ADMIN") return "/admin/access";
  const dashboard = effectivePermissions(user).dashboards[0];
  return dashboard ? DASHBOARD_ROUTES[dashboard] : "/no-access";
}

export function sessionUser(user) {
  const result = safeUser(user);
  if (!result) return null;
  return {
    ...result,
    pendingRequestCount: result.role === "ADMIN" ? state.requests.filter((request) => request.status === "PENDING").length : 0,
  };
}

export async function createAccessRequest(input) {
  const username = normalizeUsername(input.username);
  const mobile = normalizeMobile(input.mobile);
  const department = normalizeDepartment(input.department);
  const email = normalizeEmail(input.email);
  if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new Error("This username already has access.");
  if (state.requests.some((request) => request.status === "PENDING" && (request.username.toLowerCase() === username.toLowerCase() || request.email === email))) {
    throw new Error("A pending access request already exists for this username or email ID.");
  }
  const request = {
    id: crypto.randomUUID(), username, mobile, department, email,
    status: "PENDING", submittedAt: new Date().toISOString(), decisionAt: "", decisionBy: "", userId: "",
  };
  state.requests.push(request);
  await save();
  return { id: request.id, status: request.status, submittedAt: request.submittedAt };
}

export function adminAccessData() {
  return {
    dashboards: [...DASHBOARDS],
    users: state.users.map(safeUser).sort((a, b) => a.username.localeCompare(b.username)),
    requests: state.requests.slice().sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)),
  };
}

export async function decideAccessRequest(requestId, input, admin) {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request) throw new Error("Access request was not found.");
  if (request.status !== "PENDING") throw new Error("This access request has already been processed.");
  const action = String(input.action || "").toUpperCase();
  if (action === "REJECT") {
    request.status = "REJECTED";
  } else if (action === "APPROVE") {
    if (state.users.some((user) => user.username.toLowerCase() === request.username.toLowerCase())) throw new Error("This username already has access.");
    const role = input.role === "ADMIN" ? "ADMIN" : "USER";
    const user = {
      id: crypto.randomUUID(),
      username: request.username,
      mobile: request.mobile,
      department: request.department,
      email: request.email,
      role,
      active: true,
      passwordHash: await passwordHash(input.password),
      permissions: role === "ADMIN" ? { dashboards: [...DASHBOARDS], canEmail: true, canDownload: true } : normalizePermissions(input.permissions),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.users.push(user);
    request.status = "APPROVED";
    request.userId = user.id;
  } else {
    throw new Error("Choose Approve or Reject.");
  }
  request.decisionAt = new Date().toISOString();
  request.decisionBy = admin.username;
  await save();
  return adminAccessData();
}

export async function updateAccessUser(userId, input) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) throw new Error("User was not found.");
  const nextRole = input.role === "ADMIN" ? "ADMIN" : "USER";
  const nextActive = input.active !== false;
  const remainingAdmins = state.users.filter((item) => item.id !== user.id && item.active && item.role === "ADMIN").length;
  if (user.role === "ADMIN" && user.active && (nextRole !== "ADMIN" || !nextActive) && remainingAdmins === 0) {
    throw new Error("At least one active Admin account is required.");
  }
  user.role = nextRole;
  user.active = nextActive;
  user.permissions = nextRole === "ADMIN" ? { dashboards: [...DASHBOARDS], canEmail: true, canDownload: true } : normalizePermissions(input.permissions);
  if (input.password) user.passwordHash = await passwordHash(input.password);
  user.updatedAt = new Date().toISOString();
  await save();
  return adminAccessData();
}
