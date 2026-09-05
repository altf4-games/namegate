// LIVE integration tests. These hit real Sepolia and the real deployed
// beacon. Run with: npm run test:live
//
// They are deliberately NOT part of `npm test`. Everything else in the suite
// is deterministic and offline; these depend on a funded deployment, a live
// RPC, and real ENS state, so mixing them in would make the default suite
// flaky and unrunnable by anyone without a .env.
//
// What these prove that the Hardhat tests cannot: that the contract deployed
// at BEACON_ADDRESS reads the actual ENSv2 registry and resolver correctly.
// The Hardhat suite runs against test doubles, so it can only show the
// beacon's logic is self-consistent — it cannot show the ENSv2 interface was
// transcribed correctly, and in fact an earlier version of this project got
// that interface wrong in a way no amount of double-based testing would have
// caught (getResolver takes a string label, not a uint256).
//
// Every expectation below is about state that already exists on-chain. These
// tests only read; they never send a transaction or spend a fee.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { namehash } from "viem/ens";
import { publicClient } from "../../src/client.js";
import {
  beaconAbi,
  requireBeaconAddress,
  LOCKUP_UNPARSEABLE,
  type ComplianceRecord,
} from "../../src/beacon.js";
import { PARENT_NAME } from "../../src/constants.js";
import {
  CCIP_SEPOLIA_ROUTER,
  CCIP_HEDERA_TESTNET_SELECTOR,
  routerAbi,
} from "../../src/ccip.js";

const ZERO = "0x0000000000000000000000000000000000000000";

// A label that has never been registered under the parent. Not "investorb",
// which may legitimately get registered later for the blocked-investor demo.
const NEVER_REGISTERED = "no-such-investor-9f3a";

let beacon: `0x${string}`;
let abi: readonly unknown[];

function read(label: string): Promise<ComplianceRecord> {
  return publicClient.readContract({
    address: beacon,
    abi: abi as never,
    functionName: "readCompliance",
    args: [label],
  }) as Promise<ComplianceRecord>;
}

describe("ENSComplianceBeacon, live on Sepolia", () => {
  before(() => {
    beacon = requireBeaconAddress();
    abi = beaconAbi();
  });

  test("the beacon address actually holds a contract", async () => {
    const code = await publicClient.getCode({ address: beacon });
    assert.ok(code && code !== "0x", `No bytecode at ${beacon} — is BEACON_ADDRESS stale?`);
  });

  test("is wired to the registry and parent this repo expects", async () => {
    // Catches the case where BEACON_ADDRESS points at an older deployment
    // built against different addresses, which would make every other
    // assertion here meaningless.
    const [registry, parentNode, router, selector] = await Promise.all([
      publicClient.readContract({ address: beacon, abi: abi as never, functionName: "registry" }),
      publicClient.readContract({ address: beacon, abi: abi as never, functionName: "parentNode" }),
      publicClient.readContract({ address: beacon, abi: abi as never, functionName: "router" }),
      publicClient.readContract({
        address: beacon,
        abi: abi as never,
        functionName: "destinationChainSelector",
      }),
    ]);

    assert.equal(
      (registry as string).toLowerCase(),
      (process.env.ISSUER_USER_REGISTRY_ADDRESS ?? "").toLowerCase(),
    );
    assert.equal(parentNode, namehash(PARENT_NAME));
    assert.equal((router as string).toLowerCase(), CCIP_SEPOLIA_ROUTER.toLowerCase());
    assert.equal(selector, CCIP_HEDERA_TESTNET_SELECTOR);
  });

  test("derives the same node on-chain as viem does off-chain", async () => {
    const onChain = await publicClient.readContract({
      address: beacon,
      abi: abi as never,
      functionName: "nodeFor",
      args: ["investora"],
    });
    assert.equal(onChain, namehash(`investora.${PARENT_NAME}`));
  });

  test("reads investora's real compliance records off the real resolver", async () => {
    const record = await read("investora");

    assert.equal(
      record.resolver.toLowerCase(),
      (process.env.ISSUER_RESOLVER_ADDRESS ?? "").toLowerCase(),
      "beacon resolved a different resolver than the issuer's",
    );
    assert.equal(record.node, namehash(`investora.${PARENT_NAME}`));
    assert.equal(record.kyc, "verified");
    assert.equal(record.jurisdiction, "US");
    assert.equal(record.authorized, true);
    assert.ok(record.nameExpiry > 0n, "expected a real registry expiry");
  });

  test("investora's registry expiry is genuinely in the future", async () => {
    const record = await read("investora");
    const block = await publicClient.getBlock();
    assert.ok(
      record.nameExpiry > block.timestamp,
      `investora expired at ${record.nameExpiry}, chain time is ${block.timestamp}`,
    );
  });

  test("an expired name resolves to the zero address but still reports its expiry", async () => {
    // investorc was registered with a short --expires-in-seconds expiry that
    // has since passed. This is the ENSv2 expiry mechanism observed on real
    // chain state, not a simulated clock: the registry refuses to resolve it,
    // so the compliance record is structurally unreadable.
    const record = await read("investorc");
    const block = await publicClient.getBlock();

    assert.equal(record.resolver.toLowerCase(), ZERO);
    assert.equal(record.authorized, false);
    assert.equal(record.kyc, "");
    assert.ok(record.nameExpiry > 0n, "an expired name should still report when it expired");
    assert.ok(
      record.nameExpiry <= block.timestamp,
      "investorc is supposed to be expired by now",
    );
  });

  test("investora's lockup has lapsed, so lockup is not what authorizes them", async () => {
    // If this ever reads back as 0, the lockup field was cleared rather than
    // set to a past date, and the demo would be passing for the wrong reason.
    const record = await read("investora");
    const block = await publicClient.getBlock();
    assert.ok(record.lockupUntilTimestamp > 0n, "expected a real parsed lockup date");
    assert.ok(record.lockupUntilTimestamp <= block.timestamp, "investora's lockup should have lapsed");
    assert.notEqual(record.lockupUntilTimestamp, LOCKUP_UNPARSEABLE);
  });

  test("investore is blocked by lockup despite fully valid KYC", async () => {
    // The third demo beat, and the one that shows compliance is more than a
    // single KYC bit: every other field passes and the holder is still
    // blocked.
    const record = await read("investore");
    const block = await publicClient.getBlock();

    assert.notEqual(record.resolver.toLowerCase(), ZERO, "investore should still resolve");
    assert.equal(record.kyc, "verified");
    assert.ok(record.nameExpiry > block.timestamp, "investore's accreditation should be current");
    assert.ok(
      record.lockupUntilTimestamp > block.timestamp,
      "investore's lockup should still be in force",
    );
    assert.equal(record.authorized, false);
  });

  test("a never-registered name reports a zero expiry, distinct from an expired one", async () => {
    const record = await read(NEVER_REGISTERED);
    assert.equal(record.resolver.toLowerCase(), ZERO);
    assert.equal(record.authorized, false);
    assert.equal(record.nameExpiry, 0n);
  });

  test("rejects an empty label rather than returning a blank record", async () => {
    await assert.rejects(() => read(""), /EmptyLabel|reverted/i);
  });

  test("quotes a non-zero CCIP fee for a real publish", async () => {
    const investor = process.env.INVESTOR_A_ADDRESS as `0x${string}`;
    const fee = (await publicClient.readContract({
      address: beacon,
      abi: abi as never,
      functionName: "quote",
      args: ["investora", investor],
    })) as bigint;
    assert.ok(fee > 0n, "a real router should quote a non-zero fee");
  });

  test("the CCIP router still reports the Hedera lane as supported", async () => {
    // Lanes can be retired. If this fails, publish() will revert with
    // UnsupportedDestinationChain at send time rather than at deploy time.
    const supported = await publicClient.readContract({
      address: CCIP_SEPOLIA_ROUTER,
      abi: routerAbi,
      functionName: "isChainSupported",
      args: [CCIP_HEDERA_TESTNET_SELECTOR],
    });
    assert.equal(supported, true);
  });
});
