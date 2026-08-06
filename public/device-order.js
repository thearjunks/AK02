const timestamp = (device) => Date.parse(device?.addedAt || device?.firstSeenAt || "") || 0;

export function compareDevicesByAddition(a, b) {
  const aAdded = ["ADDED", "RESTORED"].includes(String(a?.deviceStatus || "").toUpperCase());
  const bAdded = ["ADDED", "RESTORED"].includes(String(b?.deviceStatus || "").toUpperCase());
  return Number(bAdded) - Number(aAdded) || timestamp(b) - timestamp(a);
}
