// Node's built-in test runner — no network, no env vars, no framework
// dependency. Run with: npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePrivateKey } from "../src/normalizePrivateKey.js";

// Generated with crypto.randomBytes(32).toString("hex") and its length
// verified programmatically, not by eye — a one-off char-count-by-hand
// error here previously produced a 31-byte fixture that passed nothing.
const VALID_HEX = "e37e0a2372358a6ae6fddb2e01fe48f5d9d020f57079535e745bd640343404a0";

test("accepts a key with a 0x prefix unchanged", () => {
  const withPrefix = `0x${VALID_HEX}`;
  assert.equal(normalizePrivateKey(withPrefix, "TEST_KEY"), withPrefix);
});

test("adds a missing 0x prefix — MetaMask's export format", () => {
  assert.equal(normalizePrivateKey(VALID_HEX, "TEST_KEY"), `0x${VALID_HEX}`);
});

test("is case-insensitive on hex digits", () => {
  const upper = VALID_HEX.toUpperCase();
  assert.equal(normalizePrivateKey(upper, "TEST_KEY"), `0x${upper}`);
});

test("rejects a key that's too short", () => {
  assert.throws(
    () => normalizePrivateKey(VALID_HEX.slice(0, 60), "TEST_KEY"),
    /doesn't look like a 32-byte hex key/,
  );
});

test("rejects a key that's too long", () => {
  assert.throws(
    () => normalizePrivateKey(VALID_HEX + "ab", "TEST_KEY"),
    /doesn't look like a 32-byte hex key/,
  );
});

test("rejects non-hex characters", () => {
  assert.throws(
    () => normalizePrivateKey("zz" + VALID_HEX.slice(2), "TEST_KEY"),
    /doesn't look like a 32-byte hex key/,
  );
});

test("rejects an empty string", () => {
  assert.throws(() => normalizePrivateKey("", "TEST_KEY"), /doesn't look like/);
});

test("rejects stray whitespace rather than silently stripping it", () => {
  assert.throws(
    () => normalizePrivateKey(`${VALID_HEX} `, "TEST_KEY"),
    /doesn't look like a 32-byte hex key/,
  );
});

test("includes the env var name in the error, so the error is actionable", () => {
  assert.throws(() => normalizePrivateKey("bad", "HEDERA_OPERATOR_KEY"), /HEDERA_OPERATOR_KEY/);
  assert.throws(() => normalizePrivateKey("bad", "ISSUER_PRIVATE_KEY"), /ISSUER_PRIVATE_KEY/);
});
