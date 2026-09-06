// Sends HBAR to the deployed CouponDistributor so it has something to pay
// out with. A plain transfer — the contract's receive() just logs it.
//
// Run: npm run hedera:fund-distributor -- 1   (sends 1 HBAR)

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

async function main() {
  const hbarArg = process.argv[2];
  if (!hbarArg) {
    throw new Error("Usage: npm run hedera:fund-distributor -- <HBAR amount>   (e.g. 1)");
  }
  const hbar = Number(hbarArg);
  if (!Number.isFinite(hbar) || hbar <= 0) {
    throw new Error(`<HBAR amount> must be a positive number, got "${hbarArg}"`);
  }

  const distributor = requireEnv("COUPON_DISTRIBUTOR_ADDRESS") as `0x${string}`;
  const value = BigInt(Math.round(hbar * 1e18));

  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  const before = await publicClient.getBalance({ address: distributor });
  console.log(`Distributor: ${distributor}`);
  console.log(`Balance before: ${before} wei`);
  console.log(`Sending: ${value} wei (${hbar} HBAR)`);

  const hash = await walletClient.sendTransaction({
    account,
    to: distributor,
    value,
    chain: publicClient.chain,
  });
  console.log(`Fund tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Funding transfer reverted. Receipt status: ${receipt.status}`);
  }

  const after = await publicClient.getBalance({ address: distributor });
  console.log(`Balance after: ${after} wei`);
  if (after !== before + value) {
    throw new Error(`Balance did not increase by the sent amount. Expected ${before + value}, got ${after}.`);
  }
  console.log("Verified: balance increased by exactly the amount sent.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
