// Node's built-in test runner. Run with: npm run test:unit
//
// describeRecord turns a beacon record into the sentence shown on screen
// during the demo. Its one job that actually matters is telling an EXPIRED
// name apart from one that was NEVER REGISTERED: both come back with a zero
// resolver and empty text records, and reporting them identically would make
// a revoked investor and a mistyped label look the same.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  describeRecord,
  explainBlock,
  LOCKUP_UNPARSEABLE,
  type ComplianceRecord,
} from "../src/beacon.js";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const RESOLVER = "0x980ea45E726BfDCb3cA242D767E7BA0acd817251" as const;
const NODE = "0xaa14cb58ac64c5ee00270f9971a5c73b2997090cf984a5e277d662bcc1881281" as const;
const OWNER = "0xe07B6c410590B998F3E16bf90507F9Be38bF6176" as const;

const NOW = 1_788_652_800n; // 2026-09-06T00:00:00Z

function record(overrides: Partial<ComplianceRecord> = {}): ComplianceRecord {
  return {
    resolver: RESOLVER,
    owner: OWNER,
    node: NODE,
    kyc: "verified",
    jurisdiction: "US",
    accreditationExpiry: "2027-03-01",
    lockupUntil: "",
    lockupUntilTimestamp: 0n,
    nameExpiry: NOW + 365n * 86_400n,
    authorized: true,
    ...overrides,
  };
}

describe("describeRecord", () => {
  test("reports an eligible investor with days remaining", () => {
    const message = describeRecord(record(), NOW);
    assert.match(message, /^ELIGIBLE/);
    assert.match(message, /365 day\(s\)/);
  });

  test("distinguishes an expired name from one that never existed", () => {
    // Both have a zero resolver. Only nameExpiry separates them, which is
    // precisely why the beacon reports the expiry even when it cannot read
    // any records.
    const expired = describeRecord(
      record({ resolver: ZERO, owner: ZERO, kyc: "", nameExpiry: NOW - 3600n, authorized: false }),
      NOW,
    );
    const missing = describeRecord(record({ resolver: ZERO, owner: ZERO, kyc: "", nameExpiry: 0n, authorized: false }), NOW);

    assert.match(expired, /^BLOCKED: accreditation expired/);
    assert.match(missing, /^BLOCKED: no such name/);
    assert.notEqual(expired, missing);
  });

  test("names the expiry instant for an expired accreditation", () => {
    const message = describeRecord(
      record({ resolver: ZERO, owner: ZERO, kyc: "", nameExpiry: 1_788_620_659n, authorized: false }),
      NOW,
    );
    assert.match(message, /2026-09-05T15:04:19\.000Z/);
  });

  test("blocks on a KYC status that is not exactly 'verified'", () => {
    for (const kyc of ["pending", "rejected", "Verified", "VERIFIED", "verified "]) {
      const message = describeRecord(record({ kyc, authorized: false }), NOW);
      assert.match(message, /^BLOCKED: compliance\.kyc is/, `expected "${kyc}" to be blocked`);
      assert.ok(message.includes(kyc), `expected the message to quote "${kyc}"`);
    }
  });

  test("shows an unset KYC status as (unset) rather than empty quotes", () => {
    const message = describeRecord(record({ kyc: "", authorized: false }), NOW);
    assert.match(message, /\(unset\)/);
  });

  test("blocks a verified investor still inside their lockup, and names the date", () => {
    const message = describeRecord(
      record({ lockupUntil: "2026-12-31", lockupUntilTimestamp: NOW + 86_400n, authorized: false }),
      NOW,
    );
    assert.match(message, /^BLOCKED: KYC is verified, but the holding is locked up until/);
    assert.ok(message.includes("2026-09-07"));
  });

  test("treats a lockup exactly at now as lapsed, matching the contract's >=", () => {
    const message = describeRecord(record({ lockupUntilTimestamp: NOW }), NOW);
    assert.match(message, /^ELIGIBLE/);
  });

  test("blocks on an unparseable lockup rather than ignoring it", () => {
    // Mirrors the contract failing closed: 0 would mean "no lockup" and would
    // authorize, so a malformed value must never collapse to that.
    const message = describeRecord(
      record({
        lockupUntil: "not-a-date",
        lockupUntilTimestamp: LOCKUP_UNPARSEABLE,
        authorized: false,
      }),
      NOW,
    );
    assert.match(message, /^BLOCKED/);
    assert.ok(message.includes("not-a-date"));
  });

  test("reports KYC failure before lockup, so the first real problem is named", () => {
    const message = describeRecord(
      record({ kyc: "pending", lockupUntilTimestamp: NOW + 86_400n, authorized: false }),
      NOW,
    );
    assert.match(message, /compliance\.kyc/);
  });

  test("checks resolvability before KYC, since an expired name has no readable KYC", () => {
    // An expired name reports kyc:"" — if the KYC branch ran first it would
    // say "kyc is (unset)", which is true but useless, and hides the fact
    // that the name expired.
    const message = describeRecord(
      record({ resolver: ZERO, owner: ZERO, kyc: "", nameExpiry: NOW - 1n, authorized: false }),
      NOW,
    );
    assert.match(message, /expired/);
  });

  test("is case-insensitive about the zero-address form", () => {
    const upper = "0x0000000000000000000000000000000000000000".toUpperCase();
    const message = describeRecord(
      record({
        resolver: `0x${upper.slice(2)}` as `0x${string}`,
        owner: ZERO,
        kyc: "",
        nameExpiry: 0n,
        authorized: false,
      }),
      NOW,
    );
    assert.match(message, /no such name/);
  });

  test("the verdict comes from the chain, not from this tool's own reasoning", () => {
    // A record the local rules would call blocked, but which the beacon says
    // is authorized. The tool must not quietly print BLOCKED and contradict
    // the chain — it has to flag the disagreement.
    const message = describeRecord(
      record({ kyc: "pending", authorized: true }),
      NOW,
    );
    assert.match(message, /^INCONSISTENT/);
    assert.ok(message.includes("authorized"));
  });

  test("flags the opposite disagreement too", () => {
    // Chain says unauthorized, local rules find nothing wrong.
    const message = describeRecord(record({ authorized: false }), NOW);
    assert.match(message, /^INCONSISTENT/);
  });

  test("blocks a name with no owner, since there is nobody to authorize", () => {
    const message = describeRecord(
      record({ owner: ZERO, authorized: false }),
      NOW,
    );
    assert.match(message, /^BLOCKED/);
    assert.ok(message.includes("no owner"));
  });

  test("names an untrusted resolver as the reason when the pinned one is known", () => {
    const rogue = "0x1111111111111111111111111111111111111111" as const;
    const message = describeRecord(
      record({ resolver: rogue, kyc: "", authorized: false }),
      NOW,
      RESOLVER,
    );
    assert.match(message, /^BLOCKED/);
    assert.ok(message.includes("not the issuer's"));
  });

  test("does not flag a resolver mismatch when no pinned resolver is supplied", () => {
    const rogue = "0x1111111111111111111111111111111111111111" as const;
    const reason = explainBlock(record({ resolver: rogue }), NOW);
    assert.equal(reason, null);
  });
});
