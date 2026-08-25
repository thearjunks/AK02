export async function applyAccessUi() {
  const response = await fetch("/api/session", { cache: "no-store" });
  if (!response.ok) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new Error("Authentication required.");
  }
  const { user } = await response.json();
  const dashboards = new Set(user.permissions.dashboards || []);
  document.querySelectorAll("[data-permission]").forEach((element) => {
    element.hidden = !dashboards.has(element.dataset.permission);
  });
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = user.role !== "ADMIN";
  });
  document.querySelectorAll("[data-download-action]").forEach((element) => {
    element.hidden = !user.permissions.canDownload;
  });
  document.querySelectorAll("[data-email-action]").forEach((element) => {
    element.hidden = !user.permissions.canEmail;
  });
  const badge = document.querySelector("#accessRequestBadge");
  if (badge) {
    badge.textContent = user.pendingRequestCount || "";
    badge.hidden = !user.pendingRequestCount;
  }
  const identity = document.querySelector("#signedInUser");
  if (identity) identity.textContent = `${user.username} | ${user.role}`;
  return user;
}
