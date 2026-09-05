// Pure logic only — no network, no viem client. Kept separate from the
// scripts so it's directly unit testable (see ens/test/compliance.test.ts).
//
// This is the ENS-side half of the eligibility check the beacon/control
// list will eventually run on-chain (docs/ARCHITECTURE.md). Keeping the
// logic here first, in TypeScript, lets the rules be nailed down and tested
// before they're ever translated into Solidity.

import { COMPLIANCE_KEYS } from "./constants.js";

/**
 * Parses a "YYYY-MM-DD" date into Unix seconds (UTC midnight).
 *
 * Registry expiry is set from this, per Day 2 of docs/BUILD-PLAN.md:
 * "Accreditation expiry = subname expiry. Don't store a date string and
 * compare it; let the name expire." Kept as a separate function (rather than
 * inlined at every call site) specifically so the date parsing itself is
 * unit tested — an off-by-one-day or timezone bug here would silently
 * shorten or extend every investor's real on-chain accreditation window.
 */
export function dateToUnixSeconds(dateStr: string): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Expected a "YYYY-MM-DD" date, got "${dateStr}"`);
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const ms = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(ms);
  // Date.UTC silently rolls invalid dates over instead of rejecting them
  // (month 13 becomes next January, Feb 30 becomes March 2). Catch that by
  // checking the constructed date reports back the exact input — this is
  // what a typo like "2027-02-30" needs to actually be rejected, not
  // silently shifted by a day or two.
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`"${dateStr}" is not a valid calendar date`);
  }
  return BigInt(Math.floor(ms / 1000));
}

/**
 * Whether `expirySeconds` (a registry/ENS expiry, or any Unix-seconds
 * deadline) has passed as of `nowSeconds`.
 *
 * `<=`, not `<`: an expiry of exactly now is treated as already expired,
 * matching ENSv2's own `ScheduledTasksCommon` convention
 * (`_timestamp <= _blockTimestamp()` reverts as "not yet future" — the same
 * boundary, applied from the other direction) — see
 * research-notes/task-d-hedera-ats.md's WrongTimestamp finding from Day 1.
 */
export function isExpired(expirySeconds: bigint, nowSeconds: bigint): boolean {
  return expirySeconds <= nowSeconds;
}

export type EligibilityInput = {
  kycStatus: string | undefined; // the raw compliance.kyc text record value
  expirySeconds: bigint; // the subname's registry expiry (== accreditation expiry)
  nowSeconds: bigint;
};

export type EligibilityResult = {
  eligible: boolean;
  reason: string;
};

/**
 * The ENS-side half of "Investor B blocked, here's why" — this is the exact
 * function the beacon's on-chain logic will eventually mirror in Solidity
 * (docs/ARCHITECTURE.md, Layer 3's `isAuthorized`). Kept here as plain,
 * heavily-tested TypeScript first.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  if (input.kycStatus !== "verified") {
    return {
      eligible: false,
      reason: `KYC status is "${input.kycStatus ?? "(unset)"}", not "verified"`,
    };
  }
  if (isExpired(input.expirySeconds, input.nowSeconds)) {
    return {
      eligible: false,
      reason: `accreditation expired at ${new Date(Number(input.expirySeconds) * 1000).toISOString()}`,
    };
  }
  return { eligible: true, reason: "KYC verified and accreditation current" };
}

/**
 * Maps 03-set-compliance.ts's parsed CLI flags onto the actual
 * compliance.* record keys, dropping any flag that wasn't provided (or was
 * provided empty). Pulled out of the script so this mapping — the single
 * place a typo'd flag name would silently mean "nothing gets written for
 * that field" — is unit tested directly, independent of viem's
 * encodeFunctionData.
 */
export function selectComplianceUpdates(
  flags: Record<string, string>,
): Array<{ key: string; value: string }> {
  const candidates: Array<[string, string | undefined]> = [
    [COMPLIANCE_KEYS.kyc, flags["kyc"]],
    [COMPLIANCE_KEYS.jurisdiction, flags["jurisdiction"]],
    [COMPLIANCE_KEYS.accreditationExpiry, flags["accreditation-expiry"]],
    [COMPLIANCE_KEYS.lockupUntil, flags["lockup-until"]],
  ];
  return candidates
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => ({ key, value }));
}

export const ONE_YEAR_SECONDS = 365n * 24n * 60n * 60n;

export type ExpiryFlag =
  | { kind: "accreditation-expiry"; value: string }
  | { kind: "expires-in-seconds"; value: string }
  | { kind: "default" };

/**
 * Resolves 02-register-investor.ts's CLI flags into an actual registry
 * expiry. Pulled out of the script (which just does argv parsing and the
 * live writeContract call) so this decision logic — which flag wins, what
 * counts as invalid, the 1-year default — is unit tested directly instead
 * of only being exercised by whatever flags happen to get passed on the
 * command line during a live run.
 */
export function resolveExpiry(flag: ExpiryFlag, nowSeconds: bigint): bigint {
  if (flag.kind === "accreditation-expiry") {
    const expiry = dateToUnixSeconds(flag.value);
    if (expiry <= nowSeconds) {
      throw new Error(
        `--accreditation-expiry ${flag.value} is not in the future. The ` +
          "registry itself rejects a past expiry (CannotSetPastExpiry) — " +
          "use a near-future date to demo an investor whose accreditation " +
          "is about to lapse, not one already expired.",
      );
    }
    return expiry;
  }
  if (flag.kind === "expires-in-seconds") {
    if (!/^\d+$/.test(flag.value)) {
      throw new Error(`--expires-in-seconds expects a positive integer, got "${flag.value}"`);
    }
    const seconds = BigInt(flag.value);
    if (seconds <= 0n) {
      throw new Error("--expires-in-seconds must be a positive integer.");
    }
    return nowSeconds + seconds;
  }
  return nowSeconds + ONE_YEAR_SECONDS;
}

/**
 * Parses 02-register-investor.ts's trailing CLI args into an ExpiryFlag.
 * Kept separate from resolveExpiry so "which flag did the user pass" and
 * "what does that flag mean" are each independently testable.
 */
export function parseExpiryFlag(flag: string | undefined, flagValue: string | undefined): ExpiryFlag {
  if (flag === "--accreditation-expiry" && flagValue) {
    return { kind: "accreditation-expiry", value: flagValue };
  }
  if (flag === "--expires-in-seconds" && flagValue) {
    return { kind: "expires-in-seconds", value: flagValue };
  }
  return { kind: "default" };
}
