import assert from "node:assert/strict";
import { deduplicateAccountDevices, normalizeMsisdn } from "../stc-account-service.mjs";

assert.equal(normalizeMsisdn("+965 5000 0001"), "50000001");
assert.throws(() => normalizeMsisdn("123"), /valid 8-digit/);

const devices = deduplicateAccountDevices([
  { msisdn: "50000001", devices: [{ productId: "A1", title: "Phone", available: false, quantity: 0 }] },
  { msisdn: "50000002", devices: [{ productId: "A1", title: "Phone", available: true, quantity: 2 }] },
]);
assert.equal(devices.length, 1);
assert.deepEqual(devices[0].accountMsisdns, ["50000001", "50000002"]);
assert.equal(devices[0].available, true);

console.log("Account service checks passed.");
