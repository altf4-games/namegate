// Node's built-in test runner. Run with: npm run test:unit
//
// This is a static guarantee that complements the live proof in
// 07-check-transfer-role.ts: even if that script is never run before a
// demo, this test fails immediately if INVESTOR_ROLE_BITMAP is ever edited
// to accidentally include ROLE_CAN_TRANSFER_ADMIN or ROLE_SET_RESOLVER —
// the two bits whose absence IS the entire security model (see
// ens/src/abi.ts's ROLES and INVESTOR_ROLE_BITMAP comments).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES, INVESTOR_ROLE_BITMAP, admin } from "../src/abi.js";

test("INVESTOR_ROLE_BITMAP does not grant ROLE_CAN_TRANSFER_ADMIN", () => {
  assert.equal(INVESTOR_ROLE_BITMAP & ROLES.CAN_TRANSFER_ADMIN, 0n);
});

test("INVESTOR_ROLE_BITMAP does not grant ROLE_SET_RESOLVER (base or admin)", () => {
  assert.equal(INVESTOR_ROLE_BITMAP & ROLES.SET_RESOLVER, 0n);
  assert.equal(INVESTOR_ROLE_BITMAP & admin(ROLES.SET_RESOLVER), 0n);
});

test("INVESTOR_ROLE_BITMAP does grant SET_SUBREGISTRY (base and admin)", () => {
  assert.notEqual(INVESTOR_ROLE_BITMAP & ROLES.SET_SUBREGISTRY, 0n);
  assert.notEqual(INVESTOR_ROLE_BITMAP & admin(ROLES.SET_SUBREGISTRY), 0n);
});

test("admin() shifts a role left by exactly 128 bits", () => {
  assert.equal(admin(ROLES.SET_RESOLVER), ROLES.SET_RESOLVER << 128n);
});

test("CAN_TRANSFER_ADMIN is already at the admin position (nybble 39, not 28)", () => {
  // Confirmed from PermissionedRegistry.sol / RegistryRolesLib.sol: this bit
  // has no separate base role, unlike every other entry in ROLES.
  assert.equal(ROLES.CAN_TRANSFER_ADMIN, (1n << 28n) << 128n);
});
