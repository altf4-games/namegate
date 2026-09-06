// Reads a real coupon amount for a holder — the actual number
// CouponDistributor will pay out, computed live from the bond's own state,
// not re-derived here.
//
// Run: npm run hedera:check-coupon -- 0xHolderAddress [couponId]

import { publicClient } from "../src/client.js";
import { bondCouponAbi } from "../src/abi.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

async function main() {
  const holder = process.argv[2];
  if (!holder) {
    throw new Error("Usage: npm run hedera:check-coupon -- <holderAddress> [couponId]");
  }
  const couponId = BigInt(process.argv[3] ?? requireEnv("COUPON_ID"));

  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;

  const [couponFor, amountFor] = await Promise.all([
    publicClient.readContract({
      address: bond,
      abi: bondCouponAbi,
      functionName: "getCouponFor",
      args: [couponId, holder as `0x${string}`],
    }),
    publicClient.readContract({
      address: bond,
      abi: bondCouponAbi,
      functionName: "getCouponAmountFor",
      args: [couponId, holder as `0x${string}`],
    }),
  ]);

  console.log(`Bond:     ${bond}`);
  console.log(`Coupon:   ${couponId}`);
  console.log(`Holder:   ${holder}`);
  console.log();
  const period = couponFor.coupon.endDate - couponFor.coupon.startDate;
  console.log(`recordDateReached: ${couponFor.recordDateReached}`);
  console.log(`tokenBalance:      ${couponFor.tokenBalance} (${couponFor.decimals} decimals)`);
  console.log(
    `rate:              ${Number(couponFor.coupon.rate) / 10 ** couponFor.coupon.rateDecimals}%`,
  );
  console.log(`period:            ${period}s (${Number(period) / 86400} days)`);
  console.log();
  console.log(`amount = ${amountFor.numerator} / ${amountFor.denominator}`);

  if (amountFor.denominator === 0n) {
    console.log("(denominator is zero — recordDate not reached yet, nothing owed)");
    return;
  }
  const amount = Number(amountFor.numerator) / Number(amountFor.denominator);
  console.log(`       = ${amount.toFixed(6)} (bond's declared currency units)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
