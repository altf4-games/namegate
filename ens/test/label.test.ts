// Node's built-in test runner. Run with: npm run test:unit
//
// Label handling is where a silent failure is most likely, because every
// lookup in this system hashes the label bytes directly. A label that differs
// only in case from the registered one produces a completely unrelated hash,
// so the beacon reports "no such name" and the registration looks like it
// never happened.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertUsableLabel } from "../src/label.js";
import { RESERVED_LABELS } from "../src/constants.js";

describe("assertUsableLabel", () => {
  test("accepts the labels this project uses", () => {
    for (const label of ["investora", "investorb", "investorf", "acme-capital", "fund2"]) {
      assert.equal(assertUsableLabel(label), label);
    }
  });

  test("rejects an uppercase label rather than silently lowercasing it", () => {
    // Lowercasing for the caller would register a different name than they
    // typed, which is its own surprise. Reject and say what to use instead.
    assert.throws(() => assertUsableLabel("InvestorA"), /normalized form/);
    assert.throws(() => assertUsableLabel("INVESTORA"), /normalized form/);
  });

  test("names the normalized form in the error, so the fix is obvious", () => {
    assert.throws(
      () => assertUsableLabel("InvestorA"),
      (error: Error) => error.message.includes('"investora"'),
    );
  });

  test("rejects a full dotted name passed where a label was expected", () => {
    // Easy mistake, and it would otherwise register a name literally
    // containing dots, which no resolver would ever find.
    assert.throws(() => assertUsableLabel("investora.namegate.eth"), /contains a dot/);
    assert.throws(() => assertUsableLabel("investora.eth"), /contains a dot/);
  });

  test("rejects an empty label", () => {
    assert.throws(() => assertUsableLabel(""), /empty/);
  });

  test("rejects labels reserved for ENSv1 migration", () => {
    for (const label of RESERVED_LABELS) {
      assert.throws(() => assertUsableLabel(label), /reserved/, `allowed "${label}"`);
    }
  });

  test("rejects labels normalization refuses outright", () => {
    // Verified against viem's normalize rather than assumed: an underscore is
    // only legal at the start of a label, and a zero-width space is an empty
    // label. A bare hyphen, checked at the same time, IS valid — so it is
    // deliberately not in this list.
    for (const label of ["under_score", "\u200b"]) {
      assert.throws(() => assertUsableLabel(label), /./, `allowed ${JSON.stringify(label)}`);
    }
  });

  test("accepts a bare hyphen, which ENSIP-15 permits", () => {
    assert.equal(assertUsableLabel("-"), "-");
  });

  test("returns the label unchanged when it is already usable", () => {
    // Callers use the return value, so it must be the same bytes that get
    // hashed — not a normalized copy that differs from what was validated.
    const label = "investora";
    assert.equal(assertUsableLabel(label), label);
  });
});
