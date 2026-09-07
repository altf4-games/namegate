// Runs the exact same read functions the dashboard calls, against the real
// deployed contracts on Sepolia and Hedera testnet — no mocks, no fixtures.
// This is the frontend-side counterpart to hedera/test/live: it exists so a
// change to read.ts's ABI wiring or field names is caught by a live call
// failing loudly, rather than by a blank card discovered during a demo.
//
// Requires .env.local to be filled in (network access to both testnets).
// Run: npm run test:live

import { describe, it, expect } from "vitest";
import { readInvestor, readBondTerms } from "../../src/lib/read";
import { env } from "../../src/lib/env";

describe("readBondTerms (live)", () => {
  it("reads the real coupon terms set on the deployed bond", async () => {
    const terms = await readBondTerms();
    expect(terms.rate).toBeGreaterThan(0n);
    expect(terms.rateDecimals).toBeGreaterThanOrEqual(0);
    expect(terms.endDate).toBeGreaterThan(terms.startDate);
    expect(terms.totalSupply).toBeGreaterThan(0n);
  });
});

describe("readInvestor (live)", () => {
  it("investorA reads as ELIGIBLE on ENS, with a real coupon entitlement", async () => {
    const investor = await readInvestor(env.investorALabel, env.investorAAddress);
    expect(investor.record.authorized).toBe(true);
    expect(investor.record.kyc).toBe("verified");
    expect(investor.description).toMatch(/^ELIGIBLE/);
    // Already paid earlier in this project — previewAmount stays a real,
    // deterministic entitlement fraction either way, but paid must be true.
    expect(investor.alreadyPaid).toBe(true);
  });

  it("investorB reads as BLOCKED on ENS, for a real, named reason", async () => {
    const investor = await readInvestor(env.investorBLabel, env.investorBAddress);
    expect(investor.record.authorized).toBe(false);
    expect(investor.record.owner.toLowerCase()).toBe(env.investorBAddress.toLowerCase());
    expect(investor.description).toMatch(/^BLOCKED: KYC is verified, but the holding is locked up/);
  });

  it("the on-chain verdict and the derived description never disagree (no INCONSISTENT)", async () => {
    const [a, b] = await Promise.all([
      readInvestor(env.investorALabel, env.investorAAddress),
      readInvestor(env.investorBLabel, env.investorBAddress),
    ]);
    expect(a.description).not.toMatch(/INCONSISTENT/);
    expect(b.description).not.toMatch(/INCONSISTENT/);
  });
});
