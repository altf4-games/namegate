// Confirms the 2-of-3 key quorum control is a REAL, enforced gate on
// Privy's live API, not just a claim from a one-off demo script. Creates a
// fresh quorum + wallet each run (Privy resources, not on-chain — free and
// disposable) and proves, with real ECDSA signatures over the documented
// signing scheme, that:
//   1. an unsigned request is rejected
//   2. a request signed by only 1 of 3 authorization keys is still
//      rejected (below the 2-of-3 threshold)
//   3. a request signed by 2 of 3 authorization keys is accepted
//
// Requires PRIVY_APP_ID, PRIVY_APP_SECRET in .env. Run: npm run test:live:privy

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import canonicalize from "canonicalize";

const PRIVY_API_BASE = "https://api.privy.io/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}

type QuorumKey = { publicKeyBase64Der: string; privateKey: crypto.KeyObject };

function generateQuorumKey(): QuorumKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKeyBase64Der: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey,
  };
}

function signPayload(privateKey: crypto.KeyObject, payload: object): string {
  const serialized = canonicalize(payload) as string;
  return crypto.sign("sha256", Buffer.from(serialized), privateKey).toString("base64");
}

async function privyRequest(
  appId: string,
  appSecret: string,
  path: string,
  body: unknown,
  authorizationSignature?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "privy-app-id": appId,
    Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
  };
  if (authorizationSignature) headers["privy-authorization-signature"] = authorizationSignature;
  return fetch(`${PRIVY_API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("Privy 2-of-3 key quorum wallet (live)", () => {
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");

  let keys: QuorumKey[];
  let walletId: string;
  let rpcUrl: string;
  let rpcBody: { method: string; params: { message: string; encoding: string } };

  before(async () => {
    keys = [generateQuorumKey(), generateQuorumKey(), generateQuorumKey()];

    const quorumResponse = await privyRequest(appId, appSecret, "/key_quorums", {
      display_name: "namegate-test-quorum",
      public_keys: keys.map((k) => k.publicKeyBase64Der),
      authorization_threshold: 2,
    });
    assert.equal(quorumResponse.status, 200, "key quorum creation should succeed");
    const quorum = (await quorumResponse.json()) as { id: string };

    const walletResponse = await privyRequest(appId, appSecret, "/wallets", {
      chain_type: "ethereum",
      owner_id: quorum.id,
    });
    assert.equal(walletResponse.status, 200, "quorum-owned wallet creation should succeed");
    const wallet = (await walletResponse.json()) as { id: string };
    walletId = wallet.id;

    rpcUrl = `${PRIVY_API_BASE}/wallets/${walletId}/rpc`;
    rpcBody = { method: "personal_sign", params: { message: "test", encoding: "utf-8" } };
  });

  test("a request with no signature is rejected", async () => {
    const response = await privyRequest(appId, appSecret, `/wallets/${walletId}/rpc`, rpcBody);
    assert.equal(response.status, 401);
  });

  test("a request signed by only 1 of 3 keys is rejected (below the 2-of-3 threshold)", async () => {
    const payload = { version: 1, method: "POST", url: rpcUrl, body: rpcBody, headers: { "privy-app-id": appId } };
    const oneSignature = signPayload(keys[0]!.privateKey, payload);
    const response = await privyRequest(appId, appSecret, `/wallets/${walletId}/rpc`, rpcBody, oneSignature);
    assert.equal(response.status, 401);
  });

  test("a request signed by 2 of 3 keys is accepted", async () => {
    const payload = { version: 1, method: "POST", url: rpcUrl, body: rpcBody, headers: { "privy-app-id": appId } };
    const twoSignatures = `${signPayload(keys[0]!.privateKey, payload)},${signPayload(keys[1]!.privateKey, payload)}`;
    const response = await privyRequest(appId, appSecret, `/wallets/${walletId}/rpc`, rpcBody, twoSignatures);
    assert.equal(response.status, 200, `Expected acceptance, got: ${JSON.stringify(await response.json())}`);
  });
});
