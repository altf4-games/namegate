// A second, DIFFERENT Privy control from the org wallet's contract-call
// allowlist policy: a 2-of-3 key quorum. The Privy track lists policies,
// signers, and key quorums as separate primitives — showing only a policy
// is thinner than it could be, so this demonstrates the quorum primitive
// specifically, with real signatures over the real Privy API, not a policy
// simulation.
//
// This creates a SEPARATE demo wallet, not the production org wallet — the
// org wallet is depended on by the live app (publish/distribute) and this
// is throwaway demo infrastructure to prove the mechanism, not something
// that should risk locking the team out of production funds.
//
// What this proves, live, in one run:
//   1. A quorum-owned wallet action with NO signature is rejected.
//   2. The same action with only 1-of-3 signatures is still rejected
//      (below the 2-of-3 threshold).
//   3. The same action with 2-of-3 valid signatures succeeds.
//
// Signing is implemented directly against Privy's documented scheme
// (RFC 8785 JSON canonicalization + ECDSA P-256 over SHA-256, base64,
// comma-delimited for multiple signatures) rather than an SDK, since this
// project has no other Privy SDK dependency yet.
//
// DEMO ONLY: the 3 authorization keys are generated and held in-process for
// this one run — nothing is persisted to disk. A real deployment would
// generate them once, store each with its own approver, and never have all
// three in one place.
//
// Run: npm run privy:create-quorum-wallet

import crypto from "node:crypto";
import canonicalize from "canonicalize";

const PRIVY_API_BASE = "https://api.privy.io/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
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
  method: "GET" | "POST",
  body: unknown | undefined,
  authorizationSignature: string | undefined,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "privy-app-id": appId,
    Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
  };
  if (authorizationSignature) headers["privy-authorization-signature"] = authorizationSignature;

  const response = await fetch(`${PRIVY_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  return { ok: response.ok, status: response.status, json };
}

async function main() {
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");

  console.log("Generating 3 P-256 authorization keys (in-process, not persisted)...");
  const keys = [generateQuorumKey(), generateQuorumKey(), generateQuorumKey()];

  console.log("Creating a 2-of-3 key quorum...");
  const quorumResult = await privyRequest(
    appId,
    appSecret,
    "/key_quorums",
    "POST",
    {
      display_name: "NameGate demo — 2-of-3 approver quorum",
      public_keys: keys.map((k) => k.publicKeyBase64Der),
      authorization_threshold: 2,
    },
    undefined,
  );
  if (!quorumResult.ok) {
    throw new Error(`Creating key quorum failed: ${JSON.stringify(quorumResult.json)}`);
  }
  const quorumId = (quorumResult.json as { id: string }).id;
  console.log(`  Quorum created: ${quorumId}`);

  console.log(`Creating a demo wallet owned by quorum ${quorumId}...`);
  const walletResult = await privyRequest(
    appId,
    appSecret,
    "/wallets",
    "POST",
    { chain_type: "ethereum", owner_id: quorumId },
    undefined,
  );
  if (!walletResult.ok) {
    throw new Error(`Creating wallet failed: ${JSON.stringify(walletResult.json)}`);
  }
  const wallet = walletResult.json as { id: string; address: string };
  console.log(`  Wallet created: ${wallet.id} (${wallet.address})`);

  // The action under test: sign a message. Chosen because it needs no gas
  // and no funded balance, so the demo proves the quorum gate itself, not
  // wallet funding.
  const rpcPath = `/wallets/${wallet.id}/rpc`;
  const rpcUrl = `${PRIVY_API_BASE}${rpcPath}`;
  const rpcBody = {
    method: "personal_sign",
    params: {
      message: "NameGate demo: release funds from the quorum-controlled wallet",
      encoding: "utf-8",
    },
  };
  const payloadBase = { version: 1, method: "POST", url: rpcUrl, body: rpcBody };

  async function attempt(label: string, signature: string | undefined, expectSuccess: boolean) {
    const result = await privyRequest(appId, appSecret, rpcPath, "POST", rpcBody, signature);
    const passed = result.ok === expectSuccess;
    console.log(
      `  ${passed ? "PASS" : "FAIL"}: ${label} -> ${result.ok ? "accepted" : `rejected (${result.status})`}`,
    );
    if (!passed) console.log(`    ${JSON.stringify(result.json)}`);
  }

  console.log("\nTest 1: no signature at all...");
  await attempt("unsigned request", undefined, false);

  console.log("Test 2: only 1 of 3 signatures (below the 2-of-3 threshold)...");
  const oneSig = signPayload(keys[0]!.privateKey, {
    ...payloadBase,
    headers: { "privy-app-id": appId },
  });
  await attempt("1-of-3 signed", oneSig, false);

  console.log("Test 3: 2 of 3 valid signatures (meets the threshold)...");
  const payload = { ...payloadBase, headers: { "privy-app-id": appId } };
  const sigA = signPayload(keys[0]!.privateKey, payload);
  const sigB = signPayload(keys[1]!.privateKey, payload);
  await attempt("2-of-3 signed", `${sigA},${sigB}`, true);

  console.log(
    "\nA real deployment would gate NameGate's coupon distributor behind exactly this: " +
      "no single signer, including the issuer alone, can move funds unilaterally.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
