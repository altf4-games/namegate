// Confirms the Privy org wallet's policy is a REAL, enforced control, not
// just a config value read back from the dashboard. Runs three checks
// against Privy's live API:
//   1. the wallet exists and has the policy attached
//   2. a transaction to a disallowed address is actually rejected by
//      Privy's own policy engine (not by this repo's code)
//   3. a transaction to an allowed address passes the policy check —
//      it can still fail for an unrelated reason (no funds, no calldata),
//      but that failure must not be "policy_violation"
//
// Requires PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_ORG_WALLET_ID,
// BEACON_ADDRESS in .env. Run: npm run test:live:privy

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const PRIVY_API_BASE = "https://api.privy.io/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}

function authHeaders(appId: string, appSecret: string) {
  return {
    "Content-Type": "application/json",
    "privy-app-id": appId,
    Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
  };
}

describe("Privy org wallet policy (live)", () => {
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");
  const walletId = requireEnv("PRIVY_ORG_WALLET_ID");
  const policyId = requireEnv("PRIVY_ORG_WALLET_POLICY_ID");
  const beaconAddress = requireEnv("BEACON_ADDRESS");

  test("the wallet exists on Privy with the policy actually attached", async () => {
    const response = await fetch(`${PRIVY_API_BASE}/wallets/${walletId}`, {
      headers: authHeaders(appId, appSecret),
    });
    assert.equal(response.status, 200);
    const wallet = (await response.json()) as { id: string; policy_ids: string[] };
    assert.equal(wallet.id, walletId);
    assert.ok(
      wallet.policy_ids.includes(policyId),
      `Wallet's policy_ids (${JSON.stringify(wallet.policy_ids)}) does not include ${policyId}`,
    );
  });

  test("a transaction to a disallowed address is rejected with policy_violation", async () => {
    const response = await fetch(`${PRIVY_API_BASE}/wallets/${walletId}/rpc`, {
      method: "POST",
      headers: authHeaders(appId, appSecret),
      body: JSON.stringify({
        method: "eth_sendTransaction",
        caip2: "eip155:11155111",
        params: {
          transaction: {
            to: "0x000000000000000000000000000000000000dead",
            value: "0x0",
            chain_id: 11155111,
          },
        },
      }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { code: string };
    assert.equal(body.code, "policy_violation");
  });

  test("a transaction to the allowed beacon address passes the policy check", async () => {
    const response = await fetch(`${PRIVY_API_BASE}/wallets/${walletId}/rpc`, {
      method: "POST",
      headers: authHeaders(appId, appSecret),
      body: JSON.stringify({
        method: "eth_sendTransaction",
        caip2: "eip155:11155111",
        params: {
          transaction: { to: beaconAddress, value: "0x0", chain_id: 11155111 },
        },
      }),
    });
    // It is allowed to fail (the wallet has no funds and sends no calldata),
    // just never for a policy reason.
    if (!response.ok) {
      const body = (await response.json()) as { code: string };
      assert.notEqual(
        body.code,
        "policy_violation",
        "An allowed address was rejected by the policy engine — the allowlist is broken.",
      );
    }
  });
});
