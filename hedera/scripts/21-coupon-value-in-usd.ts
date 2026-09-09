// Shows a coupon distribution's real HBAR amount alongside its live USD
// value, via the real Chainlink HBAR/USD Data Feed — not a hardcoded
// conversion rate. The bond's own coupon rate and nominal value are already
// USD-denominated (BondDetailsData.currency), but nothing in this project
// could previously state what an actual HBAR settlement is worth in the
// same currency the bond itself is denominated in.
//
// Run: npm run hedera:coupon-value-usd -- <holderAddress> [couponId]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient } from "../src/client.js";

const distributorArtifactPath = fileURLToPath(
  new URL("../../artifacts/contracts/hedera/CouponDistributor.sol/CouponDistributor.json", import.meta.url),
);
const priceReaderArtifactPath = fileURLToPath(
  new URL("../../artifacts/contracts/hedera/HbarUsdPriceReader.sol/HbarUsdPriceReader.json", import.meta.url),
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

async function main() {
  const holder = process.argv[2];
  if (!holder) {
    throw new Error("Usage: npm run hedera:coupon-value-usd -- <holderAddress> [couponId]");
  }
  const couponId = BigInt(process.argv[3] ?? requireEnv("COUPON_ID"));

  const distributor = requireEnv("COUPON_DISTRIBUTOR_ADDRESS") as `0x${string}`;
  const priceReader = requireEnv("PRICE_READER_ADDRESS") as `0x${string}`;

  const distributorArtifact = JSON.parse(readFileSync(distributorArtifactPath, "utf-8")) as { abi: unknown[] };
  const priceReaderArtifact = JSON.parse(readFileSync(priceReaderArtifactPath, "utf-8")) as { abi: unknown[] };

  const tinybarAmount = (await publicClient.readContract({
    address: distributor,
    abi: distributorArtifact.abi,
    functionName: "previewAmount",
    args: [couponId, holder as `0x${string}`],
  })) as bigint;

  const usdCents = (await publicClient.readContract({
    address: priceReader,
    abi: priceReaderArtifact.abi,
    functionName: "tinybarToUsdCents",
    args: [tinybarAmount],
  })) as bigint;

  const [priceCents] = (await publicClient.readContract({
    address: priceReader,
    abi: priceReaderArtifact.abi,
    functionName: "latestHbarUsdCents",
  })) as [bigint, bigint];

  const hbarAmount = Number(tinybarAmount) / 1e8;
  console.log(`Coupon ${couponId} for ${holder}:`);
  console.log(`  ${hbarAmount.toFixed(8)} HBAR`);
  console.log(`  at 1 HBAR = $${(Number(priceCents) / 100).toFixed(4)} (live Chainlink HBAR/USD)`);
  console.log(`  = $${(Number(usdCents) / 100).toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
