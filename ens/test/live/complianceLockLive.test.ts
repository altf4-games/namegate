// LIVE regression test for issuer self-revocation: investorA's
// compliance.kyc was deliberately locked (ens:lock-compliance-field) so that
// not even the issuer's own key can rewrite it without an explicit,
// auditable re-verification step (--unlock). This only works because the
// issuer's write power was migrated off EnhancedAccessControl's global
// ROOT_RESOURCE grant onto explicit per-investor grants — see
// 14-migrate-issuer-to-per-name-roles.ts for why the naive per-name revoke
// alone did nothing (ROOT_RESOURCE ORs into every resource unconditionally).
//
// This locks in both halves of that invariant: the locked field genuinely
// rejects the issuer, and every other compliance field on the same investor
// still accepts it — a lock that took out the whole name, not just one
// field, would be a much bigger regression than the one this replaces.
//
// Uses simulateContract (eth_call) rather than sending real transactions —
// this only needs to know whether the call WOULD revert, not to mutate
// state, so it costs no gas and leaves the demo's locked/unlocked state
// exactly as it found it.
//
// Run: npm run test:live

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { namehash } from "viem/ens";
import { publicClient, getIssuerAccount } from "../../src/client.js";
import { permissionedResolverAbi } from "../../src/abi.js";
import { COMPLIANCE_KEYS, PARENT_NAME } from "../../src/constants.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}

describe("Issuer self-revocation on investorA's compliance.kyc (live)", () => {
  const resolver = requireEnv("ISSUER_RESOLVER_ADDRESS") as `0x${string}`;
  const issuer = getIssuerAccount();
  const node = namehash(`investora.${PARENT_NAME}`);

  async function issuerCanWrite(key: string): Promise<boolean> {
    try {
      await publicClient.simulateContract({
        address: resolver,
        abi: permissionedResolverAbi,
        functionName: "setText",
        args: [node, key, "test"],
        account: issuer.address,
      });
      return true;
    } catch {
      return false;
    }
  }

  test("the issuer cannot write the locked field", async () => {
    assert.equal(
      await issuerCanWrite(COMPLIANCE_KEYS.kyc),
      false,
      "compliance.kyc should be locked — if this fails, either the field was never " +
        "locked or was re-verified (--unlock) and not re-locked",
    );
  });

  test("the issuer can still write every other compliance field on the same investor", async () => {
    for (const key of [
      COMPLIANCE_KEYS.jurisdiction,
      COMPLIANCE_KEYS.accreditationExpiry,
      COMPLIANCE_KEYS.lockupUntil,
    ]) {
      assert.equal(
        await issuerCanWrite(key),
        true,
        `${key} should still be writable — locking one field must not take out the whole name`,
      );
    }
  });
});
