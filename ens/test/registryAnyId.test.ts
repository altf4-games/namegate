// Node's built-in test runner. Run with: npm run test:unit
//
// Locks in a real bug found live on 2026-09: two scripts and
// 07-check-transfer-role.ts both used namehash(fullName) as the registry's
// `anyId` argument, when the registry actually expects labelhash(label) —
// a completely different value. getExpiry() and hasRoles() both silently
// resolved to a nonexistent entry and returned zero/false defaults instead
// of erroring, which is exactly the kind of wrong-but-plausible-looking
// result a test should catch before a live demo does.
//
// PermissionedRegistry.sol's own doc comment: "Many functions accept an
// anyId parameter that can be a labelhash, tokenId, or resource
// interchangeably" — a full ENS namehash of the dotted name is none of
// those three things.

import { test } from "node:test";
import assert from "node:assert/strict";
import { labelhash, namehash } from "viem/ens";

test("labelhash(label) and namehash(fullName) are different values", () => {
  // Values verified live via node --import tsx, not hand-computed.
  assert.equal(labelhash("investorc"), "0x19e5591fd10a1d129000947397a588ccb2122a6d9423a22542ed7b986b9469b4");
  assert.equal(
    namehash("investorc.namegate.eth"),
    "0x5f6ee5aa692f213fdd77b537db0be93caebe8cde86dc020358228b71b166d78e",
  );
  assert.notEqual(labelhash("investorc"), namehash("investorc.namegate.eth"));
});

test("labelhash depends only on the label, not the parent name", () => {
  // Two different parents, same label, same labelhash — the registry's
  // anyId only ever needs the label, never the full dotted name.
  assert.equal(labelhash("investorc"), labelhash("investorc"));
  assert.notEqual(namehash("investorc.namegate.eth"), namehash("investorc.other-parent.eth"));
});
