// Creates NameGate's organization wallet on Privy's Wallet API, with a
// policy attached at creation time that restricts it to sending
// transactions ONLY to the two contracts it has any business calling: the
// Sepolia beacon (publish) and the Hedera coupon distributor (distribute).
// This is the Privy "control" the B2B financial product / financial flow
// tracks require — not a demo wallet, a real server-controlled wallet with
// a real enforced policy, created and verified against Privy's live API.
//
// PRIVY_APP_SECRET is a server credential. It is read from process.env here
// and used ONLY in this Node script — never put it in frontend/.env.local
// or anything with a VITE_ prefix, which ships straight into the browser
// bundle.
//
// Run: npm run privy:create-org-wallet

const PRIVY_API_BASE = "https://api.privy.io/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

async function privyRequest(
  appId: string,
  appSecret: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${PRIVY_API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "privy-app-id": appId,
      Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Privy API ${method} ${path} -> ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");
  const beaconAddress = requireEnv("BEACON_ADDRESS");
  const distributorAddress = requireEnv("COUPON_DISTRIBUTOR_ADDRESS");

  console.log("Creating the contract-call allowlist policy...");
  const policy = (await privyRequest(appId, appSecret, "/policies", "POST", {
    version: "1.0",
    name: "NameGate org wallet — beacon and distributor only",
    chain_type: "ethereum",
    rules: [
      {
        name: "Allow beacon and distributor only",
        method: "eth_sendTransaction",
        conditions: [
          {
            field_source: "ethereum_transaction",
            field: "to",
            operator: "in",
            value: [beaconAddress, distributorAddress],
          },
        ],
        action: "ALLOW",
      },
    ],
  })) as { id: string; name: string };
  console.log(`Policy created: ${policy.id} (${policy.name})`);

  console.log("\nCreating the organization wallet, with that policy attached...");
  const wallet = (await privyRequest(appId, appSecret, "/wallets", "POST", {
    chain_type: "ethereum",
    display_name: "NameGate org wallet",
    policy_ids: [policy.id],
  })) as { id: string; address: string; policy_ids: string[] };
  console.log(`Wallet created: ${wallet.id}`);
  console.log(`Address:        ${wallet.address}`);

  // Read back rather than trusting the create response, so this script's
  // final claim is backed by a second, independent call.
  console.log("\nVerifying by reading the wallet back...");
  const readBack = (await privyRequest(appId, appSecret, `/wallets/${wallet.id}`, "GET")) as {
    id: string;
    address: string;
    policy_ids: string[];
  };
  if (readBack.id !== wallet.id || readBack.address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Read-back wallet does not match what was just created.");
  }
  if (!readBack.policy_ids.includes(policy.id)) {
    throw new Error(
      `Read-back wallet's policy_ids (${JSON.stringify(readBack.policy_ids)}) does not include the policy just created (${policy.id}).`,
    );
  }
  console.log("Verified: the wallet exists on Privy with the policy actually attached.");

  console.log("\nAdd to .env:");
  console.log(`PRIVY_ORG_WALLET_ID=${wallet.id}`);
  console.log(`PRIVY_ORG_WALLET_ADDRESS=${wallet.address}`);
  console.log(`PRIVY_ORG_WALLET_POLICY_ID=${policy.id}`);
  console.log(
    "\nThis wallet cannot send a transaction to anywhere except the beacon and the " +
      "distributor — Privy's own policy engine enforces that server-side, not this repo's code.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
