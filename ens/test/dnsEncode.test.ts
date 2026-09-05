// Node's built-in test runner. Run with: npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { dnsEncodeName } from "../src/dnsEncode.js";

test("matches the exact value used in a live transaction", () => {
  // Printed by 03-set-compliance.ts and verified fresh (not copy-pasted from
  // old terminal output) before writing this test — 0x09 = length of
  // "investora" (9), then that label, 0x08 = length of "namegate" (8), then
  // that label, 0x03 = length of "eth" (3), then that label, 0x00 terminator.
  assert.equal(
    dnsEncodeName("investora.namegate.eth"),
    "0x09696e766573746f7261086e616d65676174650365746800",
  );
});

test("changes per-label length prefixes for a different name", () => {
  // "bob" (3) . "namegate" (8) . "eth" (3)
  const encoded = dnsEncodeName("bob.namegate.eth");
  assert.equal(encoded.slice(0, 4), "0x03"); // length of "bob"
  assert.ok(encoded.endsWith("00")); // null terminator
});

test("produces a different encoding for a different label under the same parent", () => {
  const a = dnsEncodeName("investora.namegate.eth");
  const b = dnsEncodeName("investorb.namegate.eth");
  assert.notEqual(a, b);
});

test("is deterministic", () => {
  assert.equal(dnsEncodeName("investora.namegate.eth"), dnsEncodeName("investora.namegate.eth"));
});
