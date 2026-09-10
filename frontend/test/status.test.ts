import { describe, it, expect } from "vitest";
import {
  ensStatus,
  hederaStatus,
  isStale,
  lockupLabel,
  blockReason,
  canDistribute,
  distributeButtonState,
} from "../src/lib/status";
import type { InvestorView } from "../src/lib/read";

// Base fixture shaped exactly like a real readInvestor() result — field
// values are the actual ones captured live for investora.namegate.eth
// earlier in this project, not invented. Each test overrides only the
// field(s) it's actually exercising.
function makeInvestor(overrides: Partial<InvestorView> = {}): InvestorView {
  return {
    label: "investora",
    address: "0xe07B6c410590B998F3E16bf90507F9Be38bF6176",
    node: "0xaa14cb58ac64c5ee00270f9971a5c73b2997090cf984a5e277d662bcc1881281",
    record: {
      resolver: "0x980ea45E726BfDCb3cA242D767E7BA0acd817251",
      owner: "0xe07B6c410590B998F3E16bf90507F9Be38bF6176",
      node: "0xaa14cb58ac64c5ee00270f9971a5c73b2997090cf984a5e277d662bcc1881281",
      kyc: "verified",
      jurisdiction: "US",
      accreditationExpiry: "2027-09-05",
      lockupUntil: "2026-03-01",
      lockupUntilTimestamp: 1772323200n,
      nameExpiry: 1820129921n,
      authorized: true,
    },
    description: "ELIGIBLE: KYC verified, lockup lapsed, accreditation current for another 362 day(s).",
    mirrorAuthorized: true,
    staleness: 100n,
    lastAppliedAt: 1788675693n,
    couponAmountTinybar: 41_095_890n,
    alreadyPaid: false,
    ...overrides,
  };
}

describe("ensStatus / hederaStatus", () => {
  it("reports authorized when the respective chain's flag is true", () => {
    const investor = makeInvestor();
    expect(ensStatus(investor)).toBe("authorized");
    expect(hederaStatus(investor)).toBe("authorized");
  });

  it("reports blocked when the respective chain's flag is false", () => {
    const investor = makeInvestor({
      record: { ...makeInvestor().record, authorized: false },
      mirrorAuthorized: false,
    });
    expect(ensStatus(investor)).toBe("blocked");
    expect(hederaStatus(investor)).toBe("blocked");
  });
});

describe("isStale", () => {
  it("is false when ENS and the Hedera mirror agree", () => {
    expect(isStale(makeInvestor())).toBe(false);
  });

  it("is true when ENS says authorized but the mirror hasn't caught up yet — the real gap found live in this project", () => {
    expect(isStale(makeInvestor({ mirrorAuthorized: false }))).toBe(true);
  });
});

describe("lockupLabel", () => {
  it("renders a real lockup timestamp as a date", () => {
    expect(lockupLabel(makeInvestor())).toBe("2026-03-01");
  });

  it("renders zero as Expired, matching the contract's 'no lockup' sentinel", () => {
    expect(
      lockupLabel(makeInvestor({ record: { ...makeInvestor().record, lockupUntilTimestamp: 0n } })),
    ).toBe("Expired");
  });
});

describe("canDistribute", () => {
  it("is true only when the mirror authorizes, nothing's been paid, and something is owed", () => {
    expect(canDistribute(makeInvestor())).toBe(true);
  });

  it("is false once already paid — this is investorA's real current state", () => {
    expect(canDistribute(makeInvestor({ alreadyPaid: true }))).toBe(false);
  });

  it("is false when the mirror hasn't been published to yet", () => {
    expect(canDistribute(makeInvestor({ mirrorAuthorized: false }))).toBe(false);
  });

  it("is false when nothing is owed", () => {
    expect(canDistribute(makeInvestor({ couponAmountTinybar: 0n }))).toBe(false);
  });
});

describe("distributeButtonState", () => {
  it("already-paid takes priority over every other condition", () => {
    expect(
      distributeButtonState(makeInvestor({ alreadyPaid: true, mirrorAuthorized: false }), false).kind,
    ).toBe("already-paid");
  });

  it("shows distributing while a transaction is in flight, even if otherwise ready", () => {
    expect(distributeButtonState(makeInvestor(), true).kind).toBe("distributing");
  });

  it("shows locked when the Hedera mirror hasn't been published to yet — investorB's real state before any publish", () => {
    expect(distributeButtonState(makeInvestor({ mirrorAuthorized: false }), false).kind).toBe("locked");
  });

  it("shows nothing-owed when the entitlement is genuinely zero", () => {
    expect(distributeButtonState(makeInvestor({ couponAmountTinybar: 0n }), false).kind).toBe(
      "nothing-owed",
    );
  });

  it("is ready only when every condition actually allows a real payout", () => {
    expect(distributeButtonState(makeInvestor(), false).kind).toBe("ready");
  });
});

describe("blockReason", () => {
  it("returns null for a fully compliant investor when the bond is not paused", () => {
    expect(blockReason(makeInvestor(), false)).toBeNull();
  });

  it("reports the bond-wide pause first, even for a compliant investor", () => {
    const reason = blockReason(makeInvestor(), true);
    expect(reason).toMatch(/bond is paused/);
  });

  it("surfaces the ENS-side reason with the BLOCKED prefix and trailing period stripped", () => {
    const investor = makeInvestor({
      record: { ...makeInvestor().record, authorized: false },
      description: "BLOCKED: KYC is verified, but the holding is locked up until 2027-01-15.",
    });
    expect(blockReason(investor, false)).toBe(
      "KYC is verified, but the holding is locked up until 2027-01-15",
    );
  });

  it("does not flag a pure forward-sync gap (ENS authorized, mirror lagging)", () => {
    expect(blockReason(makeInvestor({ mirrorAuthorized: false }), false)).toBeNull();
  });
});
