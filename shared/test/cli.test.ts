// Node's built-in test runner. Run with: npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFlags } from "../src/cli.js";

test("parses simple --flag value pairs", () => {
  assert.deepEqual(parseFlags(["--kyc", "verified", "--jurisdiction", "US"]), {
    kyc: "verified",
    jurisdiction: "US",
  });
});

test("a trailing flag with no value gets an empty string", () => {
  assert.deepEqual(parseFlags(["--kyc"]), { kyc: "" });
});

test("a flag immediately followed by another flag gets an empty string, and the next flag still parses correctly", () => {
  // The original inline implementation this was extracted from would have
  // consumed "--jurisdiction" itself as --kyc's value and silently dropped
  // "US" entirely. This is the fix, locked in as a test.
  assert.deepEqual(parseFlags(["--kyc", "--jurisdiction", "US"]), {
    kyc: "",
    jurisdiction: "US",
  });
});

test("ignores a bare positional value with no preceding flag", () => {
  assert.deepEqual(parseFlags(["US"]), {});
});

test("returns an empty object for an empty array", () => {
  assert.deepEqual(parseFlags([]), {});
});

test("a later flag overwrites an earlier one with the same name", () => {
  assert.deepEqual(parseFlags(["--kyc", "pending", "--kyc", "verified"]), { kyc: "verified" });
});

test("does not require -- prefixed flags to be lowercase or any particular shape", () => {
  assert.deepEqual(parseFlags(["--accreditation-expiry", "2027-03-01"]), {
    "accreditation-expiry": "2027-03-01",
  });
});
