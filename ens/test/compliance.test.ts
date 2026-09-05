// Node's built-in test runner. Run with: npm run test:unit
//
// This is the highest-stakes pure logic in the project — it's the exact
// function that decides whether an investor is blocked, and its Solidity
// port will eventually run in the beacon/control list on-chain
// (docs/ARCHITECTURE.md). Test it thoroughly here, in TypeScript, before it
// ever becomes harder-to-test Solidity.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dateToUnixSeconds,
  isExpired,
  evaluateEligibility,
  resolveExpiry,
  parseExpiryFlag,
  selectComplianceUpdates,
  ONE_YEAR_SECONDS,
} from "../src/compliance.js";
import { COMPLIANCE_KEYS } from "../src/constants.js";

describe("dateToUnixSeconds", () => {
  test("parses a YYYY-MM-DD date as UTC midnight", () => {
    // 2027-03-01T00:00:00.000Z — verified with `Math.floor(Date.parse(...)/1000)`,
    // not hand-computed (see the earlier hex-fixture mistake in
    // shared/test/normalizePrivateKey.test.ts's commit history).
    assert.equal(dateToUnixSeconds("2027-03-01"), 1803859200n);
  });

  test("parses the Unix epoch itself", () => {
    assert.equal(dateToUnixSeconds("1970-01-01"), 0n);
  });

  test("rejects a date with the wrong format", () => {
    assert.throws(() => dateToUnixSeconds("03-01-2027"), /Expected a "YYYY-MM-DD" date/);
    assert.throws(() => dateToUnixSeconds("2027/03/01"), /Expected a "YYYY-MM-DD" date/);
    assert.throws(() => dateToUnixSeconds("2027-3-1"), /Expected a "YYYY-MM-DD" date/);
  });

  test("rejects a calendar-invalid date", () => {
    assert.throws(() => dateToUnixSeconds("2027-13-01"), /not a valid calendar date/);
    assert.throws(() => dateToUnixSeconds("2027-02-30"), /not a valid calendar date/);
  });

  test("rejects an empty string", () => {
    assert.throws(() => dateToUnixSeconds(""), /Expected a "YYYY-MM-DD" date/);
  });
});

describe("isExpired", () => {
  test("is false when expiry is in the future", () => {
    assert.equal(isExpired(200n, 100n), false);
  });

  test("is true when expiry is in the past", () => {
    assert.equal(isExpired(100n, 200n), true);
  });

  test("treats an expiry exactly equal to now as EXPIRED (<=, not <)", () => {
    // Matches ENSv2's own ScheduledTasksCommon convention seen in the
    // WrongTimestamp finding: "now" is not strictly future, so it doesn't
    // count as still valid either.
    assert.equal(isExpired(150n, 150n), true);
  });

  test("handles zero as a valid boundary", () => {
    assert.equal(isExpired(0n, 0n), true);
    assert.equal(isExpired(1n, 0n), false);
  });
});

describe("evaluateEligibility", () => {
  const future = 9_999_999_999n; // far future
  const past = 1n; // 1970, long expired

  test("eligible when KYC verified and not expired", () => {
    const result = evaluateEligibility({
      kycStatus: "verified",
      expirySeconds: future,
      nowSeconds: 1_000_000_000n,
    });
    assert.equal(result.eligible, true);
    assert.match(result.reason, /KYC verified and accreditation current/);
  });

  test("blocked when KYC status is missing", () => {
    const result = evaluateEligibility({
      kycStatus: undefined,
      expirySeconds: future,
      nowSeconds: 1_000_000_000n,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason, /\(unset\)/);
  });

  test("blocked when KYC status is anything other than exactly 'verified'", () => {
    for (const status of ["pending", "rejected", "Verified", "VERIFIED", "verified "]) {
      const result = evaluateEligibility({
        kycStatus: status,
        expirySeconds: future,
        nowSeconds: 1_000_000_000n,
      });
      assert.equal(result.eligible, false, `expected "${status}" to be rejected`);
      assert.match(result.reason, new RegExp(`"${status}"`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  test("blocked when accreditation has expired, even with valid KYC", () => {
    const result = evaluateEligibility({
      kycStatus: "verified",
      expirySeconds: past,
      nowSeconds: 1_000_000_000n,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason, /accreditation expired/);
  });

  test("KYC is checked before expiry — reason reflects the first failure", () => {
    // Both conditions fail; the reason should be about KYC, not expiry,
    // since evaluateEligibility checks KYC status first.
    const result = evaluateEligibility({
      kycStatus: "pending",
      expirySeconds: past,
      nowSeconds: 1_000_000_000n,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason, /KYC status/);
  });

  test("expiry exactly at now blocks — reuses isExpired's <= boundary", () => {
    const result = evaluateEligibility({
      kycStatus: "verified",
      expirySeconds: 500n,
      nowSeconds: 500n,
    });
    assert.equal(result.eligible, false);
    assert.match(result.reason, /accreditation expired/);
  });
});

describe("parseExpiryFlag", () => {
  test("recognizes --accreditation-expiry with a value", () => {
    assert.deepEqual(parseExpiryFlag("--accreditation-expiry", "2027-03-01"), {
      kind: "accreditation-expiry",
      value: "2027-03-01",
    });
  });

  test("recognizes --expires-in-seconds with a value", () => {
    assert.deepEqual(parseExpiryFlag("--expires-in-seconds", "90"), {
      kind: "expires-in-seconds",
      value: "90",
    });
  });

  test("falls back to default when no flag is given", () => {
    assert.deepEqual(parseExpiryFlag(undefined, undefined), { kind: "default" });
  });

  test("falls back to default for an unrecognized flag", () => {
    assert.deepEqual(parseExpiryFlag("--something-else", "x"), { kind: "default" });
  });

  test("falls back to default when the flag is given but the value is missing", () => {
    // Mirrors the script's original `flag === X && flagValue` guard — a
    // flag with no value should not be treated as that flag at all.
    assert.deepEqual(parseExpiryFlag("--accreditation-expiry", undefined), { kind: "default" });
    assert.deepEqual(parseExpiryFlag("--expires-in-seconds", ""), { kind: "default" });
  });
});

describe("resolveExpiry", () => {
  const now = 1_000_000_000n;

  test("--accreditation-expiry resolves to that date's Unix seconds", () => {
    const expiry = resolveExpiry({ kind: "accreditation-expiry", value: "2027-03-01" }, now);
    assert.equal(expiry, dateToUnixSeconds("2027-03-01"));
  });

  test("--accreditation-expiry in the past is rejected", () => {
    assert.throws(
      () => resolveExpiry({ kind: "accreditation-expiry", value: "1970-01-01" }, now),
      /is not in the future/,
    );
  });

  test("--accreditation-expiry exactly equal to now is rejected (not strictly future)", () => {
    // now itself, reinterpreted as a date, should be rejected the same way
    // a genuinely past date is.
    const nowAsDate = new Date(Number(now) * 1000).toISOString().slice(0, 10);
    assert.throws(
      () => resolveExpiry({ kind: "accreditation-expiry", value: nowAsDate }, now),
      /is not in the future/,
    );
  });

  test("--expires-in-seconds adds the given seconds to now", () => {
    assert.equal(resolveExpiry({ kind: "expires-in-seconds", value: "90" }, now), now + 90n);
  });

  test("--expires-in-seconds rejects zero", () => {
    assert.throws(
      () => resolveExpiry({ kind: "expires-in-seconds", value: "0" }, now),
      /must be a positive integer/,
    );
  });

  test("--expires-in-seconds rejects a non-numeric value", () => {
    assert.throws(
      () => resolveExpiry({ kind: "expires-in-seconds", value: "abc" }, now),
      /expects a positive integer/,
    );
  });

  test("--expires-in-seconds rejects a negative-looking value (regex blocks the leading -)", () => {
    assert.throws(
      () => resolveExpiry({ kind: "expires-in-seconds", value: "-5" }, now),
      /expects a positive integer/,
    );
  });

  test("default resolves to exactly one year out", () => {
    assert.equal(resolveExpiry({ kind: "default" }, now), now + ONE_YEAR_SECONDS);
  });
});

describe("selectComplianceUpdates", () => {
  test("includes only the flags that were actually provided", () => {
    const updates = selectComplianceUpdates({ kyc: "verified", jurisdiction: "US" });
    assert.deepEqual(updates, [
      { key: COMPLIANCE_KEYS.kyc, value: "verified" },
      { key: COMPLIANCE_KEYS.jurisdiction, value: "US" },
    ]);
  });

  test("returns an empty array when no relevant flags are set", () => {
    assert.deepEqual(selectComplianceUpdates({}), []);
    assert.deepEqual(selectComplianceUpdates({ unrelated: "x" }), []);
  });

  test("drops a flag that was passed with an empty value", () => {
    assert.deepEqual(selectComplianceUpdates({ kyc: "", jurisdiction: "US" }), [
      { key: COMPLIANCE_KEYS.jurisdiction, value: "US" },
    ]);
  });

  test("includes all four fields when all are provided, in a stable order", () => {
    const updates = selectComplianceUpdates({
      kyc: "verified",
      jurisdiction: "US",
      "accreditation-expiry": "2027-03-01",
      "lockup-until": "2026-12-31",
    });
    assert.deepEqual(
      updates.map((u) => u.key),
      [
        COMPLIANCE_KEYS.kyc,
        COMPLIANCE_KEYS.jurisdiction,
        COMPLIANCE_KEYS.accreditationExpiry,
        COMPLIANCE_KEYS.lockupUntil,
      ],
    );
  });
});
