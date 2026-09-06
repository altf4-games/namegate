// Hardhat/mocha contract tests. Run with: npm run test:contracts
//
// CCIPReceiver's own `onlyRouter` modifier checks nothing but
// `msg.sender == router` — the router address is a plain constructor
// argument, not a live Chainlink contract. So these tests pass a normal test
// signer as the router and call `ccipReceive` directly as that signer, which
// exercises exactly the same code path a real router would trigger. No fake
// router contract is needed; the real router's job (choosing which contract
// to deliver to, and only delivering what a real Sepolia beacon actually
// sent) is Chainlink's to prove, not this project's.
//
// What this DOES prove: the receiver's own decision logic — chain/sender
// checks, monotonic ordering, revocation-by-node, and staleness decay. What
// it does NOT prove: that a message sent by the real beacon on Sepolia
// decodes correctly here. That needs a live message to actually arrive,
// which is what ens/scripts/11-beacon-publish.ts plus a live read against
// this contract on Hedera testnet is for.

import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const SOURCE_SELECTOR = 16015286601757825753n; // Sepolia, as seen from Hedera
const WRONG_SELECTOR = 222782988166878823n; // Hedera's own selector — never a valid source
const MAX_STALENESS = 3600n; // 1 hour, short enough to test decay without waiting long

const PAYLOAD_TYPES = [
  "bytes32",
  "address",
  "bool",
  "string",
  "string",
  "string",
  "string",
  "uint64",
  "uint64",
  "uint256",
  "uint256",
];

function encodePayload({
  node,
  owner,
  authorized,
  kyc = "verified",
  jurisdiction = "US",
  accreditationExpiry = "2027-03-01",
  lockupUntil = "",
  lockupUntilTimestamp = 0n,
  nameExpiry = 4_102_444_800n,
  sourceBlock,
  sourceTimestamp,
}) {
  return hre.ethers.AbiCoder.defaultAbiCoder().encode(PAYLOAD_TYPES, [
    node,
    owner,
    authorized,
    kyc,
    jurisdiction,
    accreditationExpiry,
    lockupUntil,
    lockupUntilTimestamp,
    nameExpiry,
    sourceBlock,
    sourceTimestamp,
  ]);
}

function ccipMessage({ sender, data, sourceChainSelector = SOURCE_SELECTOR }) {
  return {
    messageId: hre.ethers.hexlify(hre.ethers.randomBytes(32)),
    sourceChainSelector,
    sender: hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [sender]),
    data,
    destTokenAmounts: [],
  };
}

function nodeFor(label) {
  return hre.ethers.keccak256(hre.ethers.toUtf8Bytes(label));
}

async function deployFixture() {
  const [router, beaconSender, stranger, investorA, investorB] = await hre.ethers.getSigners();

  const mirror = await hre.ethers.deployContract("ENSComplianceMirror", [
    router.address,
    SOURCE_SELECTOR,
    beaconSender.address,
    MAX_STALENESS,
  ]);

  return { router, beaconSender, stranger, investorA, investorB, mirror };
}

/** Delivers a message as the router would, from the trusted beacon sender. */
async function deliver(ctx, payloadOverrides) {
  const now = BigInt(await time.latest());
  const sourceBlock = payloadOverrides.sourceBlock ?? (await hre.ethers.provider.getBlockNumber());
  const data = encodePayload({
    sourceTimestamp: now,
    ...payloadOverrides,
    sourceBlock,
  });
  const message = ccipMessage({ sender: ctx.beaconSender.address, data });
  return ctx.mirror.connect(ctx.router).ccipReceive(message);
}

describe("ENSComplianceMirror", function () {
  describe("deployment", function () {
    it("stores the constructor wiring", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mirror.getRouter()).to.equal(ctx.router.address);
      expect(await ctx.mirror.sourceChainSelector()).to.equal(SOURCE_SELECTOR);
      expect(await ctx.mirror.sourceSender()).to.equal(ctx.beaconSender.address);
      expect(await ctx.mirror.maxStaleness()).to.equal(MAX_STALENESS);
    });

    it("rejects a zero router", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      // CCIPReceiver's own constructor rejects this with its own error.
      await expect(
        Mirror.deploy(hre.ethers.ZeroAddress, SOURCE_SELECTOR, ctx.beaconSender.address, MAX_STALENESS),
      ).to.be.revertedWithCustomError(Mirror, "InvalidRouter");
    });

    it("rejects a zero source sender", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      await expect(
        Mirror.deploy(ctx.router.address, SOURCE_SELECTOR, hre.ethers.ZeroAddress, MAX_STALENESS),
      ).to.be.revertedWithCustomError(Mirror, "ZeroAddress");
    });

    it("rejects a zero maxStaleness", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      await expect(
        Mirror.deploy(ctx.router.address, SOURCE_SELECTOR, ctx.beaconSender.address, 0),
      ).to.be.revertedWithCustomError(Mirror, "ZeroMaxStaleness");
    });
  });

  describe("message authenticity", function () {
    it("only the configured router may call ccipReceive", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const data = encodePayload({
        node,
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
        sourceTimestamp: BigInt(await time.latest()),
      });
      const message = ccipMessage({ sender: ctx.beaconSender.address, data });

      // A stranger calling directly, bypassing the router entirely.
      await expect(
        ctx.mirror.connect(ctx.stranger).ccipReceive(message),
      ).to.be.revertedWithCustomError(ctx.mirror, "InvalidRouter");
    });

    it("rejects a message from the wrong source chain", async function () {
      const ctx = await loadFixture(deployFixture);
      const data = encodePayload({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
        sourceTimestamp: BigInt(await time.latest()),
      });
      const message = ccipMessage({
        sender: ctx.beaconSender.address,
        data,
        sourceChainSelector: WRONG_SELECTOR,
      });

      await expect(ctx.mirror.connect(ctx.router).ccipReceive(message))
        .to.be.revertedWithCustomError(ctx.mirror, "UnauthorizedSourceChain")
        .withArgs(WRONG_SELECTOR, SOURCE_SELECTOR);
    });

    it("rejects a message from any sender other than the configured beacon", async function () {
      const ctx = await loadFixture(deployFixture);
      const data = encodePayload({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
        sourceTimestamp: BigInt(await time.latest()),
      });
      // The router is honest about chain and delivery, but the message
      // itself claims to be from someone who isn't the trusted beacon.
      const message = ccipMessage({ sender: ctx.stranger.address, data });

      await expect(ctx.mirror.connect(ctx.router).ccipReceive(message))
        .to.be.revertedWithCustomError(ctx.mirror, "UnauthorizedSender")
        .withArgs(ctx.stranger.address, ctx.beaconSender.address);
    });

    it("rejects a message carrying token transfers", async function () {
      const ctx = await loadFixture(deployFixture);
      const data = encodePayload({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
        sourceTimestamp: BigInt(await time.latest()),
      });
      const message = {
        ...ccipMessage({ sender: ctx.beaconSender.address, data }),
        destTokenAmounts: [{ token: hre.ethers.ZeroAddress, amount: 1n }],
      };

      await expect(
        ctx.mirror.connect(ctx.router).ccipReceive(message),
      ).to.be.revertedWithCustomError(ctx.mirror, "UnexpectedTokens");
    });
  });

  describe("authorization", function () {
    it("authorizes the owner from a valid message", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("reports unauthorized for an address that was never mentioned", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(false);
    });

    it("emits ComplianceApplied with the owner, verdict, and source evidence", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const now = BigInt(await time.latest());

      await expect(
        ctx.mirror.connect(ctx.router).ccipReceive(
          ccipMessage({
            sender: ctx.beaconSender.address,
            data: encodePayload({
              node,
              owner: ctx.investorA.address,
              authorized: true,
              sourceBlock: 100,
              sourceTimestamp: now,
            }),
          }),
        ),
      )
        .to.emit(ctx.mirror, "ComplianceApplied")
        .withArgs(node, ctx.investorA.address, true, 100n, now);
    });

    it("rejects an authorized=true message with a zero owner", async function () {
      const ctx = await loadFixture(deployFixture);
      // The beacon should never produce this — authorized implies a real
      // owner — but the receiver must not trust that, since a malformed or
      // buggy beacon revision could otherwise authorize the zero address.
      await expect(
        deliver(ctx, {
          node: nodeFor("investora"),
          owner: hre.ethers.ZeroAddress,
          authorized: true,
          sourceBlock: 100,
        }),
      ).to.be.revertedWithCustomError(ctx.mirror, "ZeroAddress");
    });
  });

  describe("revocation by node, not by address", function () {
    it("revokes the previous owner even when the message's owner is the zero address", async function () {
      // This is the scenario the whole design exists for: an expired ENS
      // name has no owner (the registry masks it), so the beacon's
      // revocation message carries owner == address(0). The only way to know
      // WHO to deauthorize is the mirror's own memory of who the node was
      // last bound to.
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investorc");

      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);

      await deliver(ctx, {
        node,
        owner: hre.ethers.ZeroAddress,
        authorized: false,
        kyc: "",
        sourceBlock: 200,
      });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });

    it("revokes the previous owner when the name is blocked but still has a (different) owner", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investorb");

      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });
      await deliver(ctx, {
        node,
        owner: ctx.investorA.address,
        authorized: false,
        kyc: "pending",
        sourceBlock: 200,
      });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });

    it("re-authorizing a node for a NEW owner deauthorizes the previous one", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");

      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });
      // The label was re-registered to a different address entirely.
      await deliver(ctx, { node, owner: ctx.investorB.address, authorized: true, sourceBlock: 200 });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(true);
    });

    it("re-confirming the SAME owner does not deauthorize them", async function () {
      // A routine republish of an unchanged, still-eligible record must not
      // momentarily or permanently deauthorize the very address it confirms.
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");

      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });
      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 200 });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("does not touch an unrelated address's authorization when a different node is revoked", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });
      await deliver(ctx, {
        node: nodeFor("investorb"),
        owner: ctx.investorB.address,
        authorized: true,
        sourceBlock: 100,
      });

      await deliver(ctx, {
        node: nodeFor("investorb"),
        owner: hre.ethers.ZeroAddress,
        authorized: false,
        sourceBlock: 200,
      });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(false);
    });
  });

  describe("monotonic ordering / replay protection", function () {
    it("drops a message with an equal source block rather than reverting", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");

      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });
      // A CCIP retry or duplicate delivery of the exact same message. Out-of-
      // order execution means this can genuinely happen and is not an
      // attack, so it must not revert — reverting would mark a harmless
      // duplicate as FAILED on the CCIP explorer.
      await expect(
        deliver(ctx, {
          node,
          owner: ctx.investorB.address,
          authorized: true,
          sourceBlock: 100,
        }),
      ).to.not.be.reverted;

      // The second (duplicate-block) message must have had no effect.
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(false);
    });

    it("drops a message with an older source block than one already applied", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");

      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 300 });
      // Out-of-order delivery: an older message arrives after a newer one.
      await deliver(ctx, {
        node,
        owner: hre.ethers.ZeroAddress,
        authorized: false,
        sourceBlock: 200,
      });

      // The stale revocation must not undo the newer authorization.
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("emits StaleMessageDropped instead of ComplianceApplied for a stale message", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });

      const tx = deliver(ctx, {
        node,
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });
      await expect(tx).to.emit(ctx.mirror, "StaleMessageDropped").withArgs(node, 100n, 100n);
      await expect(tx).to.not.emit(ctx.mirror, "ComplianceApplied");
    });

    it("tracks ordering independently per node", async function () {
      const ctx = await loadFixture(deployFixture);
      // investora's history must not affect what counts as stale for
      // investorb — they are unrelated names with unrelated block counters.
      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 500,
      });
      await expect(
        deliver(ctx, {
          node: nodeFor("investorb"),
          owner: ctx.investorB.address,
          authorized: true,
          sourceBlock: 100,
        }),
      ).to.not.be.reverted;
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(true);
    });

    it("accepts a strictly increasing source block", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });
      await deliver(ctx, {
        node,
        owner: ctx.investorA.address,
        authorized: false,
        kyc: "pending",
        sourceBlock: 101,
      });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });
  });

  describe("staleness decay", function () {
    it("authorizes immediately after a fresh message", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("stays authorized just under the staleness window", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });
      await time.increase(Number(MAX_STALENESS) - 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("goes stale on its own once maxStaleness elapses, with no new message", async function () {
      // The core property: nobody has to call publish() again for this
      // address to stop being authorized. If a revocation was ever needed
      // and nothing re-confirmed the record, the belief expires by itself.
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });
      await time.increase(Number(MAX_STALENESS) + 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });

    it("treats exactly maxStaleness elapsed as still fresh (<=, matching the contract's own comparison)", async function () {
      const ctx = await loadFixture(deployFixture);
      const sourceTimestamp = BigInt(await time.latest());
      await ctx.mirror.connect(ctx.router).ccipReceive(
        ccipMessage({
          sender: ctx.beaconSender.address,
          data: encodePayload({
            node: nodeFor("investora"),
            owner: ctx.investorA.address,
            authorized: true,
            sourceBlock: 100,
            sourceTimestamp,
          }),
        }),
      );
      await time.increaseTo(sourceTimestamp + MAX_STALENESS);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("a fresh re-publish resets the staleness clock", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });

      await time.increase(Number(MAX_STALENESS) - 10);
      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 200 });

      // Without the reset this would now be stale (20 past the window from
      // the FIRST message); with the reset it is fresh again.
      await time.increase(Number(MAX_STALENESS) - 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("staleness() reports elapsed seconds, and max uint if never authorized", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mirror.staleness(ctx.investorA.address)).to.equal(2n ** 256n - 1n);

      await deliver(ctx, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceBlock: 100,
      });
      await time.increase(30);
      const elapsed = await ctx.mirror.staleness(ctx.investorA.address);
      expect(elapsed).to.be.at.least(30n);
      expect(elapsed).to.be.lessThan(MAX_STALENESS);
    });

    it("does not revive a revoked address once it goes stale — revocation is not merely a staleness reset", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true, sourceBlock: 100 });
      await deliver(ctx, {
        node,
        owner: ctx.investorA.address,
        authorized: false,
        kyc: "pending",
        sourceBlock: 200,
      });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);

      // Time passing after a revocation must not un-revoke anyone.
      await time.increase(Number(MAX_STALENESS) * 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });
  });
});
