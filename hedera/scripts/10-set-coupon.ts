// Sets a real coupon on the bond via setCoupon.
//
// The Coupon struct here is the v4.1.0-ats shape (recordDate, executionDate,
// startDate, endDate, fixingDate, rate, rateDecimals, rateStatus) — NOT the
// 5-field v3.1.0-ats shape (recordDate, executionDate, rate, rateDecimals,
// period) this project's docs originally described. There is no tagged
// "v4.0.0-ats" release to diff the deployed factory against directly, so
// this was confirmed empirically: a simulateContract call with the 8-field
// shape succeeded against the real deployed bond; the 5-field shape reverted
// with an undecodable selector. See hedera/src/abi.ts's header comment.
//
// recordDate AND fixingDate must each be STRICTLY future at call time
// (ScheduledTasksCommon.WrongTimestamp, checked independently for both);
// (startDate,endDate), (recordDate,executionDate) and (fixingDate,
// executionDate) must each be non-decreasing pairs (Bond.sol's validateDates).
//
// Run: npm run hedera:set-coupon

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { bondCouponAbi } from "../src/abi.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

const RATE_STATUS_SET = 1;

async function main() {
  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  const now = Math.floor(Date.now() / 1000);
  // Real headroom past "now", same reasoning as the bond's own startingDate.
  const recordDate = BigInt(now + 90);
  const startDate = recordDate;
  const endDate = startDate + 30n * 86_400n; // a 30-day coupon period
  const fixingDate = recordDate; // rate is already fixed as of the record date
  const executionDate = endDate + 86_400n; // paid the day after the period ends
  const rate = 500n; // 5.00%
  const rateDecimals = 2;

  console.log(`Bond: ${bond}`);
  console.log(`Coupon:`);
  console.log(`  recordDate:    ${new Date(Number(recordDate) * 1000).toISOString()}`);
  console.log(`  startDate:     ${new Date(Number(startDate) * 1000).toISOString()}`);
  console.log(`  endDate:       ${new Date(Number(endDate) * 1000).toISOString()}`);
  console.log(`  fixingDate:    ${new Date(Number(fixingDate) * 1000).toISOString()}`);
  console.log(`  executionDate: ${new Date(Number(executionDate) * 1000).toISOString()}`);
  console.log(`  rate:          ${Number(rate) / 10 ** rateDecimals}%`);
  console.log(`  period:        ${endDate - startDate}s (${Number(endDate - startDate) / 86400} days)`);
  console.log();

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

  const { request, result: predictedCouponId } = await publicClient.simulateContract({
    address: bond,
    abi: bondCouponAbi,
    functionName: "setCoupon",
    args: [coupon],
    account,
  });
  console.log(`Simulation OK. Predicted couponID: ${predictedCouponId}`);

  const hash = await walletClient.writeContract(request);
  console.log(`Set-coupon tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`setCoupon reverted. Receipt status: ${receipt.status}`);
  }

  // Read the coupon back rather than trusting the simulated return value —
  // simulation ran against state that may have moved by broadcast time.
  const couponCount = await publicClient.readContract({
    address: bond,
    abi: bondCouponAbi,
    functionName: "getCouponCount",
  });
  const couponId = couponCount; // 1-indexed; the one just created is the latest
  const registered = await publicClient.readContract({
    address: bond,
    abi: bondCouponAbi,
    functionName: "getCoupon",
    args: [couponId],
  });

  console.log();
  console.log(`Verified via getCoupon(${couponId}):`);
  console.log(`  recordDate: ${registered.coupon.recordDate}`);
  console.log(`  startDate:  ${registered.coupon.startDate}`);
  console.log(`  endDate:    ${registered.coupon.endDate}`);
  console.log(`  rate:       ${registered.coupon.rate}`);

  if (registered.coupon.recordDate !== recordDate) {
    throw new Error("Registered recordDate does not match what was set.");
  }
  if (registered.coupon.endDate - registered.coupon.startDate !== endDate - startDate) {
    throw new Error("Registered period does not match what was set.");
  }

  console.log();
  console.log("Add to .env:");
  console.log(`COUPON_ID=${couponId}`);
  console.log();
  console.log(
    `Record date not yet reached — wait until ${new Date(Number(recordDate) * 1000).toISOString()} ` +
      "before getCouponAmountFor reports a real amount (npm run hedera:check-coupon).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
