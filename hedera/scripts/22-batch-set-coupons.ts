// Creates N fresh coupons on the bond in one pass. Same 5%/30-day terms as
// 10-set-coupon.ts, so the payout amount stays 0.4109589 HBAR per investor,
// matching what's already shown in the demo video and screenshots.
//
// Each coupon's dates are staggered by a few seconds from the last. ATS
// rejects two coupons sharing the exact same recordDate/fixingDate/startDate
// (reverts with an undecoded selector, 0x3a11c78b, not present in any ABI
// this project has — almost certainly a ScheduledTasksCommon uniqueness
// check keyed by timestamp, found live rather than in any doc). Staggering
// by a few seconds sidesteps it while keeping the whole batch valid within
// about the same short window, so only one wait is needed for all of them.
//
// This is pure headroom for async judging: if a judge actually clicks
// Distribute while the submission sits open for review, the active coupon
// flips to "already paid" (the AlreadyPaid guard, tested live earlier).
// Having a reserve of pre-created, already-valid coupons means swapping
// VITE_COUPON_ID to the next one and redeploying is all that's needed to
// recover, no need to re-run the whole set-coupon dance under time pressure.
//
// Run: npm run hedera:batch-set-coupons -- 15

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { bondCouponAbi } from "../src/abi.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

const RATE_STATUS_SET = 1;

async function main() {
  const count = Number(process.argv[2] ?? "15");
  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  const now = Math.floor(Date.now() / 1000);
  const baseRecordDate = now + 90;
  const rate = 500n;
  const rateDecimals = 2;

  console.log(
    `Creating ${count} coupons, recordDates from ${new Date(baseRecordDate * 1000).toISOString()}, staggered 3s apart`,
  );

  const createdIds: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const recordDate = BigInt(baseRecordDate + i * 3);
    const startDate = recordDate;
    const endDate = startDate + 30n * 86_400n;
    const fixingDate = recordDate;
    const executionDate = endDate + 86_400n;

    const coupon = {
      recordDate,
      executionDate,
      startDate,
      endDate,
      fixingDate,
      rate,
      rateDecimals,
      rateStatus: RATE_STATUS_SET,
    };

    const { request } = await publicClient.simulateContract({
      address: bond,
      abi: bondCouponAbi,
      functionName: "setCoupon",
      args: [coupon],
      account,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`setCoupon #${i + 1} reverted. tx ${hash}`);
    }
    const couponCount = await publicClient.readContract({
      address: bond,
      abi: bondCouponAbi,
      functionName: "getCouponCount",
    });
    createdIds.push(couponCount);
    console.log(`  [${i + 1}/${count}] coupon ${couponCount} created (tx ${hash})`);
  }

  console.log();
  console.log(`Created coupon IDs: ${createdIds.join(", ")}`);
  console.log(
    `All become payable from ${new Date(baseRecordDate * 1000).toISOString()} onward (each ~3s after the last).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
