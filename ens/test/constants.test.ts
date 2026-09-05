// Node's built-in test runner. Run with: npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { RESERVED_LABELS, COMPLIANCE_KEYS } from "../src/constants.js";

test("rejects labels reserved for ENSv1 migration", () => {
  for (const label of ["alice", "bob", "nick", "test"]) {
    assert.equal(RESERVED_LABELS.has(label), true, `expected "${label}" to be reserved`);
  }
});

test("is case-sensitive at the data level — callers must lowercase first", () => {
  // 02-register-investor.ts calls RESERVED_LABELS.has(label.toLowerCase()),
  // not RESERVED_LABELS.has(label) directly. Assert the set itself only
  // stores lowercase forms, so a caller who forgets to lowercase silently
  // lets a reserved label like "Alice" through — this test exists to catch
  // that omission if the set is ever changed to include mixed case.
  assert.equal(RESERVED_LABELS.has("Alice"), false);
  assert.equal(RESERVED_LABELS.has("alice"), true);
});

test("does not reserve ordinary investor labels", () => {
  for (const label of ["investora", "investorb", "namegatedemo"]) {
    assert.equal(RESERVED_LABELS.has(label), false, `did not expect "${label}" to be reserved`);
  }
});

test("compliance record keys are namespaced under compliance.*", () => {
  for (const key of Object.values(COMPLIANCE_KEYS)) {
    assert.match(key, /^compliance\./);
  }
});

test("compliance keys are all distinct", () => {
  const values = Object.values(COMPLIANCE_KEYS);
  assert.equal(new Set(values).size, values.length);
});
