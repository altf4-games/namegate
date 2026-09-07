import { namehash } from "viem/ens";
import { sepoliaClient, hederaClient } from "./chains";
import { addresses, beaconAbi, mirrorAbi, bondAbi, distributorAbi } from "./contracts";
import { env } from "./env";
import { describeRecord, type ComplianceRecord } from "../../../ens/src/beaconRecord.js";
import { PARENT_NAME } from "../../../ens/src/constants.js";

export type { ComplianceRecord };

export type InvestorView = {
  label: string;
  address: `0x${string}`;
  node: `0x${string}`;
  record: ComplianceRecord;
  description: string;
  mirrorAuthorized: boolean;
  staleness: bigint;
  lastAppliedAt: bigint;
  couponAmountTinybar: bigint;
  alreadyPaid: boolean;
};

export type BondTerms = {
  rate: bigint;
  rateDecimals: number;
  startDate: bigint;
  endDate: bigint;
  totalSupply: bigint;
  decimals: number;
};

/**
 * Reads everything the dashboard shows for one investor, from the two chains
 * directly — no server in between. Sepolia's beacon.readCompliance is the
 * "what does ENS say right now" verdict (instant, before any publish);
 * Hedera's mirror.isAuthorized is "what the bond currently enforces" (only
 * as fresh as the last successful publish() or attestation) — the two can
 * legitimately disagree, and that gap IS the point of the "Publish latest"
 * button, so both are surfaced rather than only one.
 */
export async function readInvestor(label: string, address: `0x${string}`): Promise<InvestorView> {
  const node = namehash(`${label}.${PARENT_NAME}`);

  const [record, expectedResolver, block] = await Promise.all([
    sepoliaClient.readContract({
      address: addresses.beacon,
      abi: beaconAbi,
      functionName: "readCompliance",
      args: [label],
    }) as Promise<ComplianceRecord>,
    sepoliaClient.readContract({
      address: addresses.beacon,
      abi: beaconAbi,
      functionName: "expectedResolver",
    }) as Promise<`0x${string}`>,
    sepoliaClient.getBlock(),
  ]);

  const [mirrorAuthorized, staleness, lastAppliedAt, couponAmountTinybar, alreadyPaid] =
    await Promise.all([
      hederaClient.readContract({
        address: addresses.mirror,
        abi: mirrorAbi,
        functionName: "isAuthorized",
        args: [address],
      }) as Promise<boolean>,
      hederaClient.readContract({
        address: addresses.mirror,
        abi: mirrorAbi,
        functionName: "staleness",
        args: [address],
      }) as Promise<bigint>,
      hederaClient.readContract({
        address: addresses.mirror,
        abi: mirrorAbi,
        functionName: "lastAppliedAt",
        args: [node],
      }) as Promise<bigint>,
      hederaClient.readContract({
        address: addresses.bond,
        abi: bondAbi,
        functionName: "getCouponAmountFor",
        args: [env.couponId, address],
      }) as Promise<{ numerator: bigint; denominator: bigint; recordDateReached: boolean }>,
      hederaClient.readContract({
        address: addresses.distributor,
        abi: distributorAbi,
        functionName: "paid",
        args: [env.couponId, address],
      }) as Promise<boolean>,
    ]);

  const { numerator, denominator, recordDateReached } = couponAmountTinybar;
  // Same fraction CouponDistributor.previewAmount computes on-chain — see
  // its header. Recomputed here only for display before a wallet is
  // connected; the contract's own previewAmount is the source of truth once
  // the distribute action actually runs. Matches PAYOUT_SCALE_TINYBAR's
  // default (1_000_000) — if that env var is ever overridden away from the
  // default, this preview and the contract's real payout will disagree, but
  // only in the number shown before a wallet is connected, never in what's
  // actually paid.
  const previewTinybar =
    !recordDateReached || denominator === 0n ? 0n : (numerator * 1_000_000n) / denominator;

  return {
    label,
    address,
    node,
    record,
    description: describeRecord(record, block.timestamp, expectedResolver),
    mirrorAuthorized,
    staleness,
    lastAppliedAt,
    couponAmountTinybar: previewTinybar,
    alreadyPaid,
  };
}

export async function readBondTerms(): Promise<BondTerms> {
  const [coupon, totalSupply, decimals] = await Promise.all([
    hederaClient.readContract({
      address: addresses.bond,
      abi: bondAbi,
      functionName: "getCoupon",
      args: [env.couponId],
    }) as Promise<{
      coupon: {
        rate: bigint;
        rateDecimals: number;
        startDate: bigint;
        endDate: bigint;
      };
    }>,
    hederaClient.readContract({
      address: addresses.bond,
      abi: bondAbi,
      functionName: "totalSupply",
    }) as Promise<bigint>,
    hederaClient.readContract({
      address: addresses.bond,
      abi: bondAbi,
      functionName: "decimals",
    }) as Promise<number>,
  ]);

  return {
    rate: coupon.coupon.rate,
    rateDecimals: coupon.coupon.rateDecimals,
    startDate: coupon.coupon.startDate,
    endDate: coupon.coupon.endDate,
    totalSupply,
    decimals,
  };
}
