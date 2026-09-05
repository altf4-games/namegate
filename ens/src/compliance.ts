// Pure logic only — no network, no viem client. Kept separate from the
// scripts so it's directly unit testable (see ens/test/compliance.test.ts).
//
// This is the ENS-side half of the eligibility check the beacon/control
// list will eventually run on-chain (docs/ARCHITECTURE.md). Keeping the
// logic here first, in TypeScript, lets the rules be nailed down and tested
// before they're ever translated into Solidity.

import { COMPLIANCE_KEYS } from "./constants.js";

// NOTE: there is deliberately no eligibility rule in this file. The
// authorization decision lives in ENSComplianceBeacon.sol and is read back
// on-chain — see ens/src/beacon.ts. A TypeScript copy of that rule existed
// here and drifted: it never learned about lockup periods, so it reported a
// locked-up investor as eligible while the contract blocked them. Two
// implementations of one rule is the bug; one of them being tested does not
// fix it.

/**
 * Parses a "YYYY-MM-DD" date into Unix seconds (UTC midnight).
 *
 * Registry expiry is set from this:
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
 * research-notes/task-d-hedera-ats.md's WrongTimestamp finding.
 */
export function isExpired(expirySeconds: bigint, nowSeconds: bigint): boolean {
  return expirySeconds <= nowSeconds;
}

/**
 * Picks the compliance records to write from parsed CLI flags, in a stable
 * order. A flag that was not passed, or passed empty, is left alone rather
 * than written as an empty string — clearing a record and never setting it
 * are different intentions.
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

/**
 * The earliest year `ENSComplianceBeacon.parseDate` accepts. The on-chain
 * civil-days arithmetic is only valid from the Unix epoch onward, so it
 * rejects anything earlier — while `dateToUnixSeconds` above happily parses
 * 1969. Writing a date the contract cannot parse is not a harmless
 * difference: the beacon treats an unparseable lockup as a lockup that never
 * ends, so the investor is blocked permanently with no error at write time.
 */
export const MIN_CONTRACT_YEAR = 1970;

/**
 * Throws unless `value` is a date the on-chain parser will accept.
 *
 * Deliberately stricter than `dateToUnixSeconds`: it additionally enforces
 * the year floor, so the write path rejects exactly what the contract
 * rejects. Kept in one place because the failure mode of a mismatch is
 * silent and only shows up mid-demo.
 */
export function assertContractParseableDate(key: string, value: string): void {
  let seconds: bigint;
  try {
    seconds = dateToUnixSeconds(value);
  } catch (error) {
    throw new Error(
      `${key}="${value}" is not a date the beacon can parse: ` +
        `${(error as Error).message}. The contract would treat it as an ` +
        `unparseable value and block the investor permanently.`,
    );
  }

  const year = Number(value.slice(0, 4));
  if (year < MIN_CONTRACT_YEAR) {
    throw new Error(
      `${key}="${value}" is before ${MIN_CONTRACT_YEAR}, which ENSComplianceBeacon.parseDate ` +
        "rejects. It would be treated as unparseable and block the investor permanently.",
    );
  }
  void seconds;
}

/** The compliance keys whose values must be contract-parseable dates. */
export const DATE_COMPLIANCE_KEYS: readonly string[] = [
  COMPLIANCE_KEYS.accreditationExpiry,
  COMPLIANCE_KEYS.lockupUntil,
];

/**
 * Validates every date-valued update before any of them is written, so a
 * batch either goes out entirely valid or not at all.
 */
export function assertUpdatesValid(
  updates: ReadonlyArray<{ key: string; value: string }>,
): void {
  for (const { key, value } of updates) {
    if (DATE_COMPLIANCE_KEYS.includes(key)) {
      assertContractParseableDate(key, value);
    }
  }
}
