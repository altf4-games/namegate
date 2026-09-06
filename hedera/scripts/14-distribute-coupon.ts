// Calls CouponDistributor.distribute(couponId, holder) for real — the
// actual settlement step ATS itself has no facet for.
//
// UNIT NOTE: previewAmount()/distribute() return TINYBAR (HBAR's native
// 8-decimal EVM representation), but getBalance() over the JSON-RPC relay
// reports the same HBAR scaled to 18-decimal "weibar" — 1 tinybar = 10^10
// weibar. This script reads both and converts explicitly before comparing,
// rather than assuming they're the same unit (an earlier version of this
// project did, and it was wrong — see CouponDistributor.sol's header).
//
// Run: npm run hedera:distribute -- 0xHolderAddress [couponId]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";

const artifactPath = fileURLToPath(
  new URL(
    "../../artifacts/contracts/hedera/CouponDistributor.sol/CouponDistributor.json",
    import.meta.url,
  ),
);

const TINYBAR_TO_WEIBAR = 10n ** 10n;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

async function main() {
  const holder = process.argv[2];
  if (!holder) {
    throw new Error("Usage: npm run hedera:distribute -- <holderAddress> [couponId]");
  }
  const couponId = BigInt(process.argv[3] ?? requireEnv("COUPON_ID"));

  const distributor = requireEnv("COUPON_DISTRIBUTOR_ADDRESS") as `0x${string}`;
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as { abi: unknown[] };

  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  const previewTinybar = (await publicClient.readContract({
    address: distributor,
    abi: artifact.abi as never,
    functionName: "previewAmount",
    args: [couponId, holder],
  })) as bigint;
  const previewWeibar = previewTinybar * TINYBAR_TO_WEIBAR;

  console.log(`Distributor: ${distributor}`);
  console.log(`Coupon:      ${couponId}`);
  console.log(`Holder:      ${holder}`);
  console.log(
    `Preview:     ${previewTinybar} tinybar owed (${Number(previewTinybar) / 1e8} HBAR) — ` +
      "before checking authorization",
  );
  console.log();

  const balanceBefore = await publicClient.getBalance({ address: holder as `0x${string}` });

  const { request } = await publicClient.simulateContract({
    address: distributor,
    abi: artifact.abi as never,
    functionName: "distribute",
    args: [couponId, holder],
    account,
  });

  const hash = await walletClient.writeContract(request);
  console.log(`Distribute tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`distribute() reverted. Receipt status: ${receipt.status}`);
  }

  const balanceAfter = await publicClient.getBalance({ address: holder as `0x${string}` });
  const receivedWeibar = balanceAfter - balanceBefore;

  console.log();
  console.log(`Holder balance before: ${balanceBefore} weibar`);
  console.log(`Holder balance after:  ${balanceAfter} weibar`);
  console.log(`Received:              ${receivedWeibar} weibar (${Number(receivedWeibar) / 1e18} HBAR)`);

  if (receivedWeibar !== previewWeibar) {
    throw new Error(
      `Holder's balance increased by ${receivedWeibar} weibar, not the previewed ` +
        `${previewTinybar} tinybar (${previewWeibar} weibar).`,
    );
  }
  console.log("\nVerified: the holder received exactly the previewed amount, paid for real.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
