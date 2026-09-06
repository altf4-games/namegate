// LIVE integration tests. These hit real Hedera testnet and the real
// deployed mirror and bond. Run with: npm run test:live:hedera
//
// Deliberately not part of `npm test` for the same reason as
// ens/test/live/beaconLive.test.ts: they need a funded deployment and a live
// RPC, so they'd make the default suite flaky for anyone without a .env.
//
// What these prove that the Hardhat suite cannot: that the mirror deployed
// at MIRROR_ADDRESS is wired to the real beacon and the real Hedera CCIP
// router, and that the bond's compliance gate is actually this contract and
// not the old one. The Hardhat suite runs against test doubles and a fake
// "router" signer — it can't see whether the real addresses line up.
//
// Every expectation below is read-only.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { publicClient } from "../../src/client.js";
import { externalControlListManagementAbi } from "../../src/abi.js";
import { ATS_ROLES } from "../../src/constants.js";
import { getIssuerAccount } from "../../src/client.js";

const HEDERA_CCIP_ROUTER = "0x802C5F84eAD128Ff36fD6a3f8a418e339f467Ce4";
const SEPOLIA_SOURCE_SELECTOR = 16015286601757825753n;

function requireEnv(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value as `0x${string}`;
}

let mirror: `0x${string}`;
let bond: `0x${string}`;
let oldControlList: `0x${string}`;
let mirrorAbi: readonly unknown[];

before(() => {
  mirror = requireEnv("MIRROR_ADDRESS");
  bond = requireEnv("BOND_ADDRESS");
  oldControlList = requireEnv("ENS_CONTROL_LIST_ADDRESS");
  mirrorAbi = [
    { type: "function", name: "sourceChainSelector", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
    { type: "function", name: "sourceSender", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { type: "function", name: "getRouter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { type: "function", name: "maxStaleness", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "isAuthorized", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
    { type: "function", name: "staleness", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "attestationThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "attestationValidityWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "attestationSigners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  ] as const;
});

describe("ENSComplianceMirror, live on Hedera testnet", () => {
  test("the mirror address actually holds a contract", async () => {
    const code = await publicClient.getCode({ address: mirror });
    assert.ok(code && code !== "0x", `No bytecode at ${mirror} — is MIRROR_ADDRESS stale?`);
  });

  test("is wired to the real Hedera CCIP router", async () => {
    const router = await publicClient.readContract({
      address: mirror,
      abi: mirrorAbi,
      functionName: "getRouter",
    });
    assert.equal((router as string).toLowerCase(), HEDERA_CCIP_ROUTER.toLowerCase());
  });

  test("trusts Sepolia's real CCIP selector as seen from Hedera", async () => {
    const selector = await publicClient.readContract({
      address: mirror,
      abi: mirrorAbi,
      functionName: "sourceChainSelector",
    });
    assert.equal(selector, SEPOLIA_SOURCE_SELECTOR);
  });

  test("trusts the real deployed beacon as its source sender", async () => {
    const sender = await publicClient.readContract({
      address: mirror,
      abi: mirrorAbi,
      functionName: "sourceSender",
    });
    assert.equal((sender as string).toLowerCase(), (process.env.BEACON_ADDRESS ?? "").toLowerCase());
  });

  test("has a non-zero maxStaleness", async () => {
    const value = await publicClient.readContract({
      address: mirror,
      abi: mirrorAbi,
      functionName: "maxStaleness",
    });
    assert.ok((value as bigint) > 0n);
  });

  test("the attestation fallback is configured with a real, funded threshold", async () => {
    const [threshold, window, signers] = await Promise.all([
      publicClient.readContract({ address: mirror, abi: mirrorAbi, functionName: "attestationThreshold" }),
      publicClient.readContract({ address: mirror, abi: mirrorAbi, functionName: "attestationValidityWindow" }),
      publicClient.readContract({ address: mirror, abi: mirrorAbi, functionName: "attestationSigners" }),
    ]);
    assert.ok((threshold as bigint) > 0n);
    assert.ok((window as bigint) > 0n);
    assert.ok((threshold as bigint) <= BigInt((signers as string[]).length));
    assert.ok((signers as string[]).length >= 2, "expect at least 2 configured signers");
  });

  test("the bond's only compliance gate is the mirror, not the old control list", async () => {
    const [mirrorRegistered, oldRegistered] = await Promise.all([
      publicClient.readContract({
        address: bond,
        abi: externalControlListManagementAbi,
        functionName: "isExternalControlList",
        args: [mirror],
      }),
      publicClient.readContract({
        address: bond,
        abi: externalControlListManagementAbi,
        functionName: "isExternalControlList",
        args: [oldControlList],
      }),
    ]);
    assert.equal(mirrorRegistered, true, "mirror should be registered on the bond");
    assert.equal(oldRegistered, false, "old control list should have been removed");
  });

  test("the issuer holds ROLE_CONTROL_LIST_MANAGER — the role that actually gates external control list management", async () => {
    // Locks in the fix for the role mix-up found live: this project used to
    // check hasRole against a DIFFERENT role (_CONTROL_LIST_ROLE, which
    // gates ATS's own internal blacklist) under this same name. That check
    // trivially returned true — it was the role actually granted — and hid
    // the bug until addExternalControlList itself was called and reverted.
    // Checking the correct constant here is what would have caught it.
    const abi = [
      {
        type: "function",
        name: "hasRole",
        stateMutability: "view",
        inputs: [{ type: "bytes32" }, { type: "address" }],
        outputs: [{ type: "bool" }],
      },
    ] as const;
    const issuer = getIssuerAccount().address;
    const has = await publicClient.readContract({
      address: bond,
      abi,
      functionName: "hasRole",
      args: [ATS_ROLES.ROLE_CONTROL_LIST_MANAGER, issuer],
    });
    assert.equal(has, true);
  });
});
