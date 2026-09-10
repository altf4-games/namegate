// Pure decision logic pulled out of InvestorCard so it's unit-testable
// without rendering anything — the same "pure logic, no network" separation
// the rest of this project already follows (see ens/src/compliance.ts).

import type { InvestorView } from "./read";
import { formatDate } from "./format";

export type EligibilityStatus = "authorized" | "blocked";

export function ensStatus(investor: InvestorView): EligibilityStatus {
  return investor.record.authorized ? "authorized" : "blocked";
}

export function hederaStatus(investor: InvestorView): EligibilityStatus {
  return investor.mirrorAuthorized ? "authorized" : "blocked";
}

/** True only when ENS and the Hedera mirror currently disagree — the exact gap "Publish latest" exists to close. */
export function isStale(investor: InvestorView): boolean {
  return investor.record.authorized !== investor.mirrorAuthorized;
}

/**
 * The one-line reason an investor is blocked for a real compliance cause, or
 * null if nothing does. This is the "point at the record and show why" beat:
 * the verdict still comes from the chain, this only names the cause.
 *
 * Scope is deliberate. A bond-wide pause overrides everything and is reported
 * first. Otherwise it's whatever `describeRecord` worked out from the ENS
 * record (expired, locked, not KYC'd, untrusted resolver), prefix stripped.
 * A pure forward-sync gap — ENS clears the investor but the Hedera mirror
 * hasn't caught up yet — is NOT reported here: it isn't a compliance block,
 * the "stale" chip and the "Publish latest" button already say so, and a red
 * "blocked" callout next to a green "authorized" badge just reads as a bug.
 */
export function blockReason(investor: InvestorView, bondPaused: boolean): string | null {
  if (bondPaused) {
    return "the bond is paused — every transfer and issuance is frozen bond-wide until the issuer lifts it";
  }
  if (investor.record.authorized) return null;
  return investor.description.replace(/^BLOCKED:\s*/, "").replace(/\.$/, "");
}

export function lockupLabel(investor: InvestorView): string {
  return investor.record.lockupUntilTimestamp === 0n
    ? "Expired"
    : formatDate(investor.record.lockupUntilTimestamp);
}

/** Whether a real, currently-unpaid amount is actually claimable right now. */
export function canDistribute(investor: InvestorView): boolean {
  return investor.mirrorAuthorized && !investor.alreadyPaid && investor.couponAmountTinybar > 0n;
}

export type DistributeButtonState =
  | { kind: "already-paid" }
  | { kind: "locked" }
  | { kind: "nothing-owed" }
  | { kind: "distributing" }
  | { kind: "ready" };

export function distributeButtonState(
  investor: InvestorView,
  distributing: boolean,
): DistributeButtonState {
  if (investor.alreadyPaid) return { kind: "already-paid" };
  if (distributing) return { kind: "distributing" };
  if (!investor.mirrorAuthorized) return { kind: "locked" };
  if (investor.couponAmountTinybar === 0n) return { kind: "nothing-owed" };
  return { kind: "ready" };
}
