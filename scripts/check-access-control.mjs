import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  adminAccessData,
  authenticateUser,
  canAccessDashboard,
  createAccessRequest,
  decideAccessRequest,
  loadAccessControl,
  updateAccessUser,
} from "../access-control.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stc-rbac-"));
try {
  const admin = await loadAccessControl({ adminUsername: "arjun.sajimon", adminPassword: "AK1AK", storagePath: path.join(directory, "access.json") });
  assert.equal((await authenticateUser("arjun.sajimon", "AK1AK")).role, "ADMIN");
  assert.equal(await authenticateUser("arjun.sajimon", "wrong"), null);

  const request = await createAccessRequest({ username: "test.user", mobile: "50000001", department: "Digital", email: "test.user@stc.com.kw" });
  await decideAccessRequest(request.id, {
    action: "APPROVE", role: "USER", password: "Test1",
    permissions: { dashboards: ["stock"], canEmail: false, canDownload: true },
  }, admin);
  const user = await authenticateUser("test.user", "Test1");
  assert.equal(canAccessDashboard(user, "stock"), true);
  assert.equal(canAccessDashboard(user, "all"), false);
  assert.equal(user.permissions.canDownload, true);
  assert.equal(user.permissions.canEmail, false);

  const adminRecord = adminAccessData().users.find((item) => item.username === "arjun.sajimon");
  await assert.rejects(() => updateAccessUser(adminRecord.id, { role: "USER", active: true, permissions: {} }), /At least one active Admin/);
  console.log("Access-control checks passed.");
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
