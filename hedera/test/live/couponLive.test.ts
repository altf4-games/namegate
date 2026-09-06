// LIVE integration tests. These hit real Hedera testnet and the real
// deployed CouponDistributor. Run with: npm run test:live:coupon
//
// The one thing this file exists specifically to lock in: Hedera's EVM
// represents HBAR in 8-decimal tinybar internally, while eth_getBalance
// over the JSON-RPC relay reports the same balance scaled to 18-decimal
// weibar. A local Hardhat network cannot reproduce this — its own EVM has
// no tinybar/weibar distinction to get wrong, so the Hardhat suite proves
// the contract's arithmetic is self-consistent but cannot prove which real
// unit it's actually operating in. This test proves it against the real
// chain, the same way it was first discovered: by comparing
// nativeBalance() (read from inside the contract's own execution) against
// getBalance (the external RPC view of the same address) and asserting the
// gap is exactly 10^10 — not roughly, not "close enough". If Hedera's EVM
// semantics ever change, or if payoutScale ever gets miscalibrated back to
// an 18-decimal assumption, this is what catches it before a real payout
// silently pays 10 billion times too much or too little.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { publicClient } from "../../src/client.js";

const TINYBAR_TO_WEIBAR = 10n ** 10n;

function requireEnv(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value as `0x${string}`;
}

let distributor: `0x${string}`;
let bond: `0x${string}`;
let mirror: `0x${string}`;
let abi: readonly unknown[];

before(() => {
  distributor = requireEnv("COUPON_DISTRIBUTOR_ADDRESS");
  bond = requireEnv("BOND_ADDRESS");
  mirror = requireEnv("MIRROR_ADDRESS");
  abi = [
    { type: "function", name: "bond", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { type: "function", name: "controlList", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { type: "function", name: "payoutScale", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "nativeBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    {
      type: "function",
      name: "previewAmount",
      stateMutability: "view",
      inputs: [{ type: "uint256" }, { type: "address" }],
      outputs: [{ type: "uint256" }],
    },
  ] as const;
});

describe("CouponDistributor, live on Hedera testnet", () => {
  test("the distributor address actually holds a contract", async () => {
    const code = await publicClient.getCode({ address: distributor });
    assert.ok(code && code !== "0x", `No bytecode at ${distributor} — is COUPON_DISTRIBUTOR_ADDRESS stale?`);
  });

  test("is wired to the real bond and mirror", async () => {
    const [wiredBond, wiredControlList] = await Promise.all([
      publicClient.readContract({ address: distributor, abi, functionName: "bond" }),
      publicClient.readContract({ address: distributor, abi, functionName: "controlList" }),
    ]);
    assert.equal((wiredBond as string).toLowerCase(), bond.toLowerCase());
    assert.equal((wiredControlList as string).toLowerCase(), mirror.toLowerCase());
  });

  test("has a non-zero payoutScale", async () => {
    const scale = await publicClient.readContract({ address: distributor, abi, functionName: "payoutScale" });
    assert.ok((scale as bigint) > 0n);
  });

  test("nativeBalance() and getBalance() report the exact same real balance, 10^10 apart", async () => {
    // This is the regression test for the bug itself. nativeBalance() is
    // read via a staticcall INTO the contract's own execution (tinybar,
    // 8-decimal); getBalance is the external JSON-RPC view of the same
    // address at the same moment (weibar, 18-decimal). If this ratio is
    // ever anything other than exactly 10^10, either Hedera's EVM semantics
    // changed or something is badly wrong with how balances are being read.
    const [native, external] = await Promise.all([
      publicClient.readContract({ address: distributor, abi, functionName: "nativeBalance" }),
      publicClient.getBalance({ address: distributor }),
    ]);
    assert.equal(
      external,
      (native as bigint) * TINYBAR_TO_WEIBAR,
      `expected getBalance (${external}) to equal nativeBalance (${native}) * 10^10`,
    );
  });

  test("previewAmount is computed in the same native tinybar unit as nativeBalance", async () => {
    // A sanity bound, not an exact-amount check (the real coupon balance
    // changes as the demo runs) — previewAmount for a genuinely authorized,
    // entitled holder should be a plausible tinybar amount (i.e. small
    // relative to nativeBalance's own typical magnitude), not something
    // that looks like an 18-decimal number that slipped back in.
    const investorA = process.env.INVESTOR_A_ADDRESS;
    if (!investorA) return; // optional — skip cleanly if not configured
    const couponId = BigInt(process.env.COUPON_ID ?? "1");
    const preview = (await publicClient.readContract({
      address: distributor,
      abi,
      functionName: "previewAmount",
      args: [couponId, investorA],
    })) as bigint;
    // A tinybar amount for a realistic demo-scale coupon should be well
    // under 10^15 tinybar (10 million HBAR) — an 18-decimal-scaled mistake
    // would produce something enormously larger than that for the same
    // real-world entitlement.
    assert.ok(preview < 10n ** 15n, `previewAmount (${preview}) looks 18-decimal-scaled, not tinybar`);
  });
});
