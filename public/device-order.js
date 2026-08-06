const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
const timestamp = (device) => Date.parse(device?.firstSeenAt || "") || 0;

export function deviceLifecycleStatus(device, now = Date.now()) {
  if (String(device?.deviceStatus || "").toUpperCase() === "REMOVED") return "REMOVED";
  const firstSeen = timestamp(device);
  return firstSeen && now - firstSeen < FIFTEEN_DAYS ? "NEW" : "EXISTING";
}

export function compareDevicesByAddition(a, b) {
  const rank = (device) => ({ NEW: 0, EXISTING: 1, REMOVED: 2 })[deviceLifecycleStatus(device)];
  return rank(a) - rank(b) || timestamp(b) - timestamp(a);
}

export function compareRemovedDevices(a, b) {
  const removedTime = (device) => Date.parse(device?.removedAt || device?.lastSeenAt || device?.firstSeenAt || "") || 0;
  return removedTime(b) - removedTime(a);
}
