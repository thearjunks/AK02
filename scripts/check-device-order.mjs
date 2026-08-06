import assert from "node:assert/strict";
import { compareDevicesByAddition } from "../public/device-order.js";

const devices = [
  { deviceName: "Active newer", deviceStatus: "ACTIVE", firstSeenAt: "2026-08-06T08:00:00Z" },
  { deviceName: "Added older", deviceStatus: "ADDED", addedAt: "2026-08-04T08:00:00Z" },
  { deviceName: "Added newest", deviceStatus: "ADDED", addedAt: "2026-08-05T08:00:00Z" },
  { deviceName: "Restored", deviceStatus: "RESTORED", addedAt: "2026-08-03T08:00:00Z" }
].sort(compareDevicesByAddition);

assert.deepEqual(devices.map(({ deviceName }) => deviceName), [
  "Added newest", "Added older", "Restored", "Active newer"
]);
console.log("Device addition ordering check passed.");
