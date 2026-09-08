// LIVE regression test for a real bug found and fixed live: a previous
// mirror deployment (from before the EIP-712 attestation rewrite) was left
// registered as a SECOND external control list on the bond after a
// redeploy. ATS requires EVERY registered list to authorize an account
// (see ExternalControlListManagementStorageWrapper._isExternallyAuthorized
// — a loop that ANDs isAuthorized() across all of them), so that abandoned
// list — which never received another update — silently blocked issue()
// and every transfer for EVERY account, including ones the current mirror
// correctly authorized. The bug was invisible in the rest of the test
// suite because CouponDistributor.distribute() checks the mirror directly
// and never goes through the bond's own multi-list check at all.
//
// This locks in the invariant that broke: the bond's registered external
// control lists must be EXACTLY {MIRROR_ADDRESS} — no more, no less. A
// future mirror redeploy that forgets to remove the old one before adding
// the new one will fail this test immediately, instead of surfacing three
// steps deep into an onboarding flow as an undecodable AccountIsBlocked.
//
// Run: npm run test:live:hedera

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { publicClient } from "../../src/client.js";
import { externalControlListManagementAbi } from "../../src/abi.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}

describe("Bond's external control list configuration (live)", () => {
  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const mirror = requireEnv("MIRROR_ADDRESS") as `0x${string}`;

  test("the current mirror is registered", async () => {
    const registered = await publicClient.readContract({
      address: bond,
      abi: externalControlListManagementAbi,
      functionName: "isExternalControlList",
      args: [mirror],
    });
    assert.equal(registered, true, `MIRROR_ADDRESS (${mirror}) is not a registered control list on the bond.`);
  });

  test("exactly one external control list is registered — no orphans from a past redeploy", async () => {
    const count = (await publicClient.readContract({
      address: bond,
      abi: externalControlListManagementAbi,
      functionName: "getExternalControlListsCount",
    })) as bigint;
    assert.equal(
      count,
      1n,
      `Expected exactly 1 registered external control list (the current mirror), found ${count}. ` +
        "Every registered list must authorize an account for issue()/transfer to succeed, so an " +
        "extra, abandoned one silently blocks everyone — see this file's header for the real bug " +
        "this caught.",
    );
  });

  test("the registered list is the current mirror, and nothing else", async () => {
    const members = (await publicClient.readContract({
      address: bond,
      abi: externalControlListManagementAbi,
      functionName: "getExternalControlListsMembers",
      args: [0n, 10n],
    })) as readonly `0x${string}`[];
    assert.deepEqual(
      members.map((m) => m.toLowerCase()),
      [mirror.toLowerCase()],
      `Registered control lists ${JSON.stringify(members)} do not match exactly [${mirror}].`,
    );
  });
});
