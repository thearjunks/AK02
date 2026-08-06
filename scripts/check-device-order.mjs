import assert from "node:assert/strict";
import { collectCatalogProducts } from "../stc-service.mjs";
import { compareDevicesByAddition, compareRemovedDevices, deviceLifecycleStatus } from "../public/device-order.js";

const now = Date.parse("2026-08-06T08:00:00Z");
const devices = [
  { deviceName: "Existing", deviceStatus: "ACTIVE", firstSeenAt: "2026-07-01T08:00:00Z" },
  { deviceName: "New older", deviceStatus: "ACTIVE", firstSeenAt: "2026-08-04T08:00:00Z" },
  { deviceName: "New newest", deviceStatus: "ADDED", firstSeenAt: "2026-08-05T08:00:00Z" },
  { deviceName: "Removed", deviceStatus: "REMOVED", firstSeenAt: "2026-08-06T08:00:00Z" }
].sort(compareDevicesByAddition);

assert.deepEqual(devices.map(({ deviceName }) => deviceName), [
  "New newest", "New older", "Existing", "Removed"
]);
assert.equal(deviceLifecycleStatus({ firstSeenAt: "2026-07-22T08:00:01Z" }, now), "NEW");
assert.equal(deviceLifecycleStatus({ firstSeenAt: "2026-07-22T08:00:00Z" }, now), "EXISTING");
assert.deepEqual([
  { name: "Older", removedAt: "2026-08-01T00:00:00Z" },
  { name: "Newest", removedAt: "2026-08-05T00:00:00Z" }
].sort(compareRemovedDevices).map((device) => device.name), ["Newest", "Older"]);

const product = (slug) => ({ type: "StcB2cCardDevice", model: slug, link: { href: `/product/SMARTPHONE/${slug}` } });
const catalogs = [
  { block: [{ type: "StcCwsBreadcrumbs", items: [{ link: { href: "/en" } }] }, { type: "StcB2cStoreFilterDevices", items: [product("fold8")] }] },
  { block: [{ type: "StcB2cStoreFilterDevices", items: [product("fold8"), product("flip8")] }] }
];
assert.deepEqual(collectCatalogProducts(catalogs).map((item) => item.model), ["fold8", "flip8"]);
console.log("Device lifecycle and catalog synchronization checks passed.");
