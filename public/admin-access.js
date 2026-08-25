import { applyAccessUi } from "./access-ui.js?v=20260825-1";

const currentUser = await applyAccessUi();
if (currentUser.role !== "ADMIN") window.location.assign("/all-devices");

const DASHBOARD_LABELS = {
  all: "All Devices", stock: "Stock", zed: "zeed Price", content: "Content",
  removed: "Removed", plans: "Plans", master: "Device Master", accounts: "Account Devices",
};
const state = { users: [], requests: [], dashboards: [] };
const els = Object.fromEntries(["adminMessage", "accessMetrics", "requestStatusFilter", "requestList", "userSearch", "userList"].map((id) => [id, document.querySelector(`#${id}`)]));
const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-KW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";

function showMessage(text, mode) {
  els.adminMessage.hidden = false;
  els.adminMessage.className = `connectionMessage ${mode}`;
  els.adminMessage.textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed with HTTP ${response.status}.`);
  return result;
}

function permissionInputs(prefix, permissions = {}, disabled = false) {
  const allowed = new Set(permissions.dashboards || []);
  return `<fieldset class="permissionSet" ${disabled ? "disabled" : ""}><legend>Dashboard access</legend>
    <div class="permissionGrid">${state.dashboards.map((dashboard) => `<label><input type="checkbox" data-dashboard="${dashboard}" ${allowed.has(dashboard) ? "checked" : ""} /> ${esc(DASHBOARD_LABELS[dashboard])}</label>`).join("")}</div>
    <div class="featurePermissions"><label><input type="checkbox" data-feature="email" ${permissions.canEmail ? "checked" : ""} /> Email sending</label><label><input type="checkbox" data-feature="download" ${permissions.canDownload ? "checked" : ""} /> Download reports</label></div>
  </fieldset>`;
}

function permissionsFrom(container) {
  return {
    dashboards: [...container.querySelectorAll("[data-dashboard]:checked")].map((input) => input.dataset.dashboard),
    canEmail: Boolean(container.querySelector('[data-feature="email"]:checked')),
    canDownload: Boolean(container.querySelector('[data-feature="download"]:checked')),
  };
}

function renderMetrics() {
  const pending = state.requests.filter((request) => request.status === "PENDING").length;
  const active = state.users.filter((user) => user.active).length;
  const admins = state.users.filter((user) => user.active && user.role === "ADMIN").length;
  els.accessMetrics.innerHTML = [[pending, "Pending requests"], [active, "Active users"], [admins, "Admins"], [state.users.length, "Total accounts"]]
    .map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderRequests() {
  const filter = els.requestStatusFilter.value;
  const requests = state.requests.filter((request) => !filter || request.status === filter);
  if (!requests.length) {
    els.requestList.innerHTML = '<div class="accountEmpty">No access requests match this filter.</div>';
    return;
  }
  els.requestList.innerHTML = requests.map((request) => `<article class="accessRow requestRow" data-request-id="${esc(request.id)}">
    <div class="accessIdentity"><strong>${esc(request.username)}</strong><span>${esc(request.email)}</span><span>${esc(request.mobile)} | ${esc(request.department)}</span></div>
    <div><span class="statusPill ${request.status === "PENDING" ? "added" : request.status === "APPROVED" ? "active" : "removed"}">${esc(request.status)}</span><small>Submitted ${esc(formatDate(request.submittedAt))}</small></div>
    ${request.status === "PENDING" ? `<div class="requestDecision"><label class="field"><span>Role</span><select data-role><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></label><label class="field"><span>Initial password</span><input data-password type="password" autocomplete="new-password" placeholder="Required for approval" /></label>${permissionInputs(`request-${request.id}`)}<div class="decisionActions"><button class="button secondary" data-action="reject" type="button">Reject</button><button class="button primary" data-action="approve" type="button">Approve</button></div></div>` : `<div class="decisionSummary"><strong>${esc(request.decisionBy || "Admin")}</strong><span>${esc(formatDate(request.decisionAt))}</span></div>`}
  </article>`).join("");
}

function renderUsers() {
  const query = els.userSearch.value.trim().toLowerCase();
  const users = state.users.filter((user) => [user.username, user.email, user.department, user.role].join(" ").toLowerCase().includes(query));
  els.userList.innerHTML = users.map((user) => `<article class="accessRow userRow" data-user-id="${esc(user.id)}">
    <div class="accessIdentity"><strong>${esc(user.username)}</strong><span>${esc(user.email || "Admin account")}</span><span>${esc(user.department || "-")}</span></div>
    <div class="userControls"><label class="field"><span>Role</span><select data-role><option value="USER" ${user.role === "USER" ? "selected" : ""}>USER</option><option value="ADMIN" ${user.role === "ADMIN" ? "selected" : ""}>ADMIN</option></select></label><label class="toggleField"><input data-active type="checkbox" ${user.active ? "checked" : ""} /> Active</label><label class="field"><span>New password</span><input data-password type="password" autocomplete="new-password" placeholder="Leave blank to keep" /></label></div>
    ${permissionInputs(`user-${user.id}`, user.permissions, user.role === "ADMIN")}
    <div class="saveUser"><span>Updated ${esc(formatDate(user.updatedAt))}</span><button class="button primary" data-action="save-user" type="button">Save permissions</button></div>
  </article>`).join("");
}

function update(data) {
  Object.assign(state, data);
  renderMetrics();
  renderRequests();
  renderUsers();
}

els.requestStatusFilter.addEventListener("change", renderRequests);
els.userSearch.addEventListener("input", renderUsers);

els.requestList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const row = button.closest("[data-request-id]");
  const action = button.dataset.action.toUpperCase();
  const payload = { action };
  if (action === "APPROVE") {
    payload.role = row.querySelector("[data-role]").value;
    payload.password = row.querySelector("[data-password]").value;
    payload.permissions = permissionsFrom(row);
  }
  button.disabled = true;
  try {
    update(await api(`/api/admin/requests/${encodeURIComponent(row.dataset.requestId)}`, { method: "PATCH", body: JSON.stringify(payload) }));
    showMessage(`Access request ${action === "APPROVE" ? "approved" : "rejected"}.`, "success");
  } catch (error) {
    showMessage(error.message, "error");
    button.disabled = false;
  }
});

els.userList.addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-action="save-user"]');
  if (!button) return;
  const row = button.closest("[data-user-id]");
  const payload = {
    role: row.querySelector("[data-role]").value,
    active: row.querySelector("[data-active]").checked,
    password: row.querySelector("[data-password]").value,
    permissions: permissionsFrom(row),
  };
  button.disabled = true;
  try {
    update(await api(`/api/admin/users/${encodeURIComponent(row.dataset.userId)}`, { method: "PATCH", body: JSON.stringify(payload) }));
    showMessage("User permissions updated successfully.", "success");
  } catch (error) {
    showMessage(error.message, "error");
    button.disabled = false;
  }
});

try { update(await api("/api/admin/access")); } catch (error) { showMessage(error.message, "error"); }
