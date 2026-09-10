import { namehash } from "viem/ens";
import { sepoliaClient, hederaClient } from "./chains";
import {
  addresses,
  beaconAbi,
  mirrorAbi,
  bondAbi,
  distributorAbi,
  pauseSwitchAbi,
  priceReaderAbi,
} from "./contracts";
import { env } from "./env";
import { describeRecord, type ComplianceRecord } from "../../../ens/src/beaconRecord.js";
import { PARENT_NAME, COMPLIANCE_KEYS } from "../../../ens/src/constants.js";
import { permissionedResolverAbi } from "../../../ens/src/abi.js";

export type { ComplianceRecord };

/**
 * Whether the Hedera mirror currently authorizes this address — the one
 * check that actually matters before issuing tokens to it. A publish()
 * transaction confirming on Sepolia only proves the CCIP router accepted
 * the message; delivery to Hedera takes minutes, and issue() genuinely
 * reverts with AccountIsBlocked until it lands. Polling this, rather than
 * gating on the Sepolia tx alone, is what the onboarding form's step 4
 * actually waits on.
 */
export async function readMirrorAuthorized(address: `0x${string}`): Promise<boolean> {
  return hederaClient.readContract({
    address: addresses.mirror,
    abi: mirrorAbi,
    functionName: "isAuthorized",
    args: [address],
  }) as Promise<boolean>;
}

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
  /**
   * True when the issuer has locked its own write access to this name's
   * `compliance.kyc` field — the "not even me can quietly change a verified
   * field" control. Detected by simulating the issuer's own setText and
   * seeing it revert; there is no dedicated getter for a per-key text role.
   */
  kycLocked: boolean;
};

export type BondTerms = {
  rate: bigint;
  rateDecimals: number;
  startDate: bigint;
  endDate: bigint;
  totalSupply: bigint;
  decimals: number;
  /** True when the issuer's pause switch is on — every transfer and issuance is frozen bond-wide. */
  paused: boolean;
  /** Live HBAR/USD price in whole US cents, from the Chainlink feed via HbarUsdPriceReader. */
  hbarUsdCents: bigint;
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

  // Would the issuer's own key still be allowed to write compliance.kyc on
  // this name? If the simulated call reverts, the field is locked. Isolated
  // from the reads above so a resolver hiccup here can't blank the card.
  let kycLocked = false;
  try {
    await sepoliaClient.simulateContract({
      address: env.issuerResolverAddress,
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [node, COMPLIANCE_KEYS.kyc, record.kyc || "verified"],
      account: env.issuerAddress,
    });
  } catch {
    kycLocked = true;
  }

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
    kycLocked,
  };
}

export async function readBondTerms(): Promise<BondTerms> {
  const [coupon, totalSupply, decimals, paused, price] = await Promise.all([
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
    hederaClient.readContract({
      address: addresses.pauseSwitch,
      abi: pauseSwitchAbi,
      functionName: "isPaused",
    }) as Promise<boolean>,
    hederaClient.readContract({
      address: addresses.priceReader,
      abi: priceReaderAbi,
      functionName: "latestHbarUsdCents",
    }) as Promise<readonly [bigint, bigint]>,
  ]);

  return {
    rate: coupon.coupon.rate,
    rateDecimals: coupon.coupon.rateDecimals,
    startDate: coupon.coupon.startDate,
    endDate: coupon.coupon.endDate,
    totalSupply,
    decimals,
    paused,
    hbarUsdCents: price[0],
  };
}
