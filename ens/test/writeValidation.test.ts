// Node's built-in test runner. Run with: npm run test:unit
//
// The write path has to reject exactly what ENSComplianceBeacon.parseDate
// rejects. A value the contract cannot parse is not a cosmetic problem: the
// beacon treats an unparseable lockup as a lockup that never ends, so the
// investor is blocked permanently, with the failure surfacing only when
// someone reads the record back — potentially mid-demo.
//
// The cases below are the same ones test/contracts/ParseDate.test.js asserts
// the contract rejects, kept in step deliberately.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertContractParseableDate,
  assertUpdatesValid,
  MIN_CONTRACT_YEAR,
} from "../src/compliance.js";
import { COMPLIANCE_KEYS } from "../src/constants.js";

describe("assertContractParseableDate", () => {
  test("accepts the dates this project actually writes", () => {
    for (const value of ["2026-03-01", "2027-03-01", "2027-06-30", "2028-02-29"]) {
      assert.doesNotThrow(() => assertContractParseableDate("k", value), `rejected ${value}`);
    }
  });

  test("accepts the epoch boundary the contract allows", () => {
    assert.doesNotThrow(() => assertContractParseableDate("k", `${MIN_CONTRACT_YEAR}-01-01`));
  });

  test("rejects years before the contract's floor, which dateToUnixSeconds alone would accept", () => {
    // This is the case the two implementations disagreed on: the TypeScript
    // parser is happy with 1969, the contract is not.
    assert.throws(() => assertContractParseableDate("k", "1969-12-31"), /before 1970/);
  });

  test("rejects malformed shapes", () => {
    for (const value of ["2026/12/31", "12-31-2026", "2026-1-1", "not-a-date", "", "1798675200"]) {
      assert.throws(
        () => assertContractParseableDate("k", value),
        /cannot parse|not a date|Expected/i,
        `accepted ${value}`,
      );
    }
  });

  test("rejects calendar-invalid dates", () => {
    for (const value of ["2027-02-30", "2027-02-29", "2026-13-01", "2026-11-31"]) {
      assert.throws(() => assertContractParseableDate("k", value), /./, `accepted ${value}`);
    }
  });

  test("names the offending key and value, so the error is actionable", () => {
    assert.throws(
      () => assertContractParseableDate(COMPLIANCE_KEYS.lockupUntil, "nope"),
      (error: Error) =>
        error.message.includes(COMPLIANCE_KEYS.lockupUntil) && error.message.includes("nope"),
    );
  });
});

describe("assertUpdatesValid", () => {
  test("passes a batch of valid updates", () => {
    assert.doesNotThrow(() =>
      assertUpdatesValid([
        { key: COMPLIANCE_KEYS.kyc, value: "verified" },
        { key: COMPLIANCE_KEYS.accreditationExpiry, value: "2027-03-01" },
        { key: COMPLIANCE_KEYS.lockupUntil, value: "2026-03-01" },
      ]),
    );
  });

  test("does not apply date rules to non-date keys", () => {
    // Jurisdiction is a free-text field; validating it as a date would be
    // wrong, and "US" obviously is not one.
    assert.doesNotThrow(() =>
      assertUpdatesValid([
        { key: COMPLIANCE_KEYS.jurisdiction, value: "US" },
        { key: COMPLIANCE_KEYS.kyc, value: "verified" },
      ]),
    );
  });

  test("rejects the whole batch when any date is bad, before anything is written", () => {
    assert.throws(() =>
      assertUpdatesValid([
        { key: COMPLIANCE_KEYS.kyc, value: "verified" },
        { key: COMPLIANCE_KEYS.lockupUntil, value: "2027-02-30" },
      ]),
    );
  });

  test("checks both date-valued keys, not just the first", () => {
    assert.throws(
      () =>
        assertUpdatesValid([
          { key: COMPLIANCE_KEYS.accreditationExpiry, value: "2027-03-01" },
          { key: COMPLIANCE_KEYS.lockupUntil, value: "garbage" },
        ]),
      /lockup-until/,
    );
  });
});
