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
// checks, ordering, revocation-by-node, staleness decay, and the EIP-712
// attestation fallback's signature verification and threshold enforcement.
// What it does NOT prove: that a message sent by the real beacon on Sepolia
// decodes correctly here, or that a real off-chain signer's tooling produces
// a signature this contract accepts. That needs a live message and a live
// signature to actually arrive, which is what ens/scripts/11-beacon-publish.ts
// and hedera/scripts/08-submit-attestation.ts plus a live read against this
// contract on Hedera testnet are for.

import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const SOURCE_SELECTOR = 16015286601757825753n; // Sepolia, as seen from Hedera
const WRONG_SELECTOR = 222782988166878823n; // Hedera's own selector — never a valid source
const MAX_STALENESS = 3600n; // 1 hour, short enough to test decay without waiting long
const ATTESTATION_WINDOW = 600n; // 10 minutes

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
  sourceBlock = 1,
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
  const [router, beaconSender, stranger, investorA, investorB, signer1, signer2, signer3] =
    await hre.ethers.getSigners();

  const signers = [signer1.address, signer2.address, signer3.address];
  const threshold = 2;

  const mirror = await hre.ethers.deployContract("ENSComplianceMirror", [
    router.address,
    SOURCE_SELECTOR,
    beaconSender.address,
    MAX_STALENESS,
    signers,
    threshold,
    ATTESTATION_WINDOW,
  ]);

  return {
    router,
    beaconSender,
    stranger,
    investorA,
    investorB,
    signer1,
    signer2,
    signer3,
    signers,
    threshold,
    mirror,
  };
}

/** Delivers a CCIP message as the router would, from the trusted beacon
 *  sender, first advancing the chain's clock to `timestamp` — a real beacon
 *  message's sourceTimestamp is always <= the delivering chain's clock by
 *  the time it lands (CCIP takes real minutes), so tests keep that true too
 *  rather than relying solely on the contract's defensive future-timestamp
 *  handling to paper over an unrealistic ordering. */
async function deliverAt(ctx, timestamp, payloadOverrides) {
  if (timestamp > BigInt(await time.latest())) {
    await time.increaseTo(timestamp);
  }
  const data = encodePayload({ sourceTimestamp: timestamp, ...payloadOverrides });
  const message = ccipMessage({ sender: ctx.beaconSender.address, data });
  return ctx.mirror.connect(ctx.router).ccipReceive(message);
}

/** Delivers a CCIP message at the current block's timestamp. */
async function deliver(ctx, payloadOverrides) {
  return deliverAt(ctx, BigInt(await time.latest()), payloadOverrides);
}

const ATTESTATION_TYPES = {
  ComplianceAttestation: [
    { name: "node", type: "bytes32" },
    { name: "owner", type: "address" },
    { name: "authorized", type: "bool" },
    { name: "kyc", type: "string" },
    { name: "jurisdiction", type: "string" },
    { name: "accreditationExpiry", type: "string" },
    { name: "lockupUntil", type: "string" },
    { name: "lockupUntilTimestamp", type: "uint64" },
    { name: "nameExpiry", type: "uint64" },
    { name: "attestedAt", type: "uint256" },
  ],
};

async function domainFor(mirror) {
  const network = await hre.ethers.provider.getNetwork();
  return {
    name: "NameGateENSComplianceMirror",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await mirror.getAddress(),
  };
}

function attestationValue({
  node,
  owner,
  authorized,
  kyc = "verified",
  jurisdiction = "US",
  accreditationExpiry = "2027-03-01",
  lockupUntil = "",
  lockupUntilTimestamp = 0n,
  nameExpiry = 4_102_444_800n,
  attestedAt,
}) {
  return {
    node,
    owner,
    authorized,
    kyc,
    jurisdiction,
    accreditationExpiry,
    lockupUntil,
    lockupUntilTimestamp,
    nameExpiry,
    attestedAt,
  };
}

/** Signs `value` with every signer in `signers`, sorted by recovered address
 *  ascending — the order submitAttestation requires. */
async function signSorted(mirror, signers, value) {
  const domain = await domainFor(mirror);
  const entries = await Promise.all(
    signers.map(async (s) => ({
      address: (await s.getAddress()).toLowerCase(),
      signature: await s.signTypedData(domain, ATTESTATION_TYPES, value),
    })),
  );
  entries.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  return entries.map((e) => e.signature);
}

describe("ENSComplianceMirror", function () {
  describe("deployment", function () {
    it("stores the constructor wiring", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mirror.getRouter()).to.equal(ctx.router.address);
      expect(await ctx.mirror.sourceChainSelector()).to.equal(SOURCE_SELECTOR);
      expect(await ctx.mirror.sourceSender()).to.equal(ctx.beaconSender.address);
      expect(await ctx.mirror.maxStaleness()).to.equal(MAX_STALENESS);
      expect(await ctx.mirror.attestationThreshold()).to.equal(2n);
      expect(await ctx.mirror.attestationValidityWindow()).to.equal(ATTESTATION_WINDOW);
      expect(await ctx.mirror.attestationSigners()).to.deep.equal(ctx.signers);
    });

    const baseArgs = (ctx) => [
      ctx.router.address,
      SOURCE_SELECTOR,
      ctx.beaconSender.address,
      MAX_STALENESS,
      ctx.signers,
      ctx.threshold,
      ATTESTATION_WINDOW,
    ];

    it("rejects a zero router", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[0] = hre.ethers.ZeroAddress;
      // CCIPReceiver's own constructor rejects this with its own error.
      await expect(Mirror.deploy(...args)).to.be.revertedWithCustomError(Mirror, "InvalidRouter");
    });

    it("rejects a zero source sender", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[2] = hre.ethers.ZeroAddress;
      await expect(Mirror.deploy(...args)).to.be.revertedWithCustomError(Mirror, "ZeroAddress");
    });

    it("rejects a zero maxStaleness", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[3] = 0;
      await expect(Mirror.deploy(...args)).to.be.revertedWithCustomError(Mirror, "ZeroMaxStaleness");
    });

    it("rejects a zero threshold", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[5] = 0;
      await expect(Mirror.deploy(...args)).to.be.revertedWithCustomError(Mirror, "ZeroThreshold");
    });

    it("rejects a threshold greater than the number of signers", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[5] = ctx.signers.length + 1;
      await expect(Mirror.deploy(...args)).to.be.revertedWithCustomError(
        Mirror,
        "ThresholdExceedsSignerCount",
      );
    });

    it("rejects a zero address among the signers", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[4] = [ctx.signer1.address, hre.ethers.ZeroAddress];
      await expect(Mirror.deploy(...args)).to.be.revertedWithCustomError(Mirror, "ZeroAddress");
    });

    it("rejects a duplicate signer", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[4] = [ctx.signer1.address, ctx.signer1.address];
      await expect(Mirror.deploy(...args)).to.be.revertedWithCustomError(Mirror, "DuplicateSigner");
    });

    it("accepts a 1-of-1 configuration", async function () {
      const ctx = await loadFixture(deployFixture);
      const Mirror = await hre.ethers.getContractFactory("ENSComplianceMirror");
      const args = baseArgs(ctx);
      args[4] = [ctx.signer1.address];
      args[5] = 1;
      await expect(Mirror.deploy(...args)).to.not.be.reverted;
    });
  });

  describe("message authenticity (CCIP path)", function () {
    it("only the configured router may call ccipReceive", async function () {
      const ctx = await loadFixture(deployFixture);
      const data = encodePayload({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceTimestamp: BigInt(await time.latest()),
      });
      const message = ccipMessage({ sender: ctx.beaconSender.address, data });
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
        sourceTimestamp: BigInt(await time.latest()),
      });
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

    it("rejects an authorized=true message with a zero owner", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(
        deliver(ctx, { node: nodeFor("investora"), owner: hre.ethers.ZeroAddress, authorized: true }),
      ).to.be.revertedWithCustomError(ctx.mirror, "ZeroAddress");
    });
  });

  describe("authorization (CCIP path)", function () {
    it("authorizes the owner from a valid message", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, { node: nodeFor("investora"), owner: ctx.investorA.address, authorized: true });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("reports unauthorized for an address that was never mentioned", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, { node: nodeFor("investora"), owner: ctx.investorA.address, authorized: true });
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(false);
    });

    it("emits ComplianceApplied with the owner, verdict, timestamp, and viaAttestation=false", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const now = BigInt(await time.latest()) + 10n;
      await time.increaseTo(now);

      await expect(deliverAt(ctx, now, { node, owner: ctx.investorA.address, authorized: true }))
        .to.emit(ctx.mirror, "ComplianceApplied")
        .withArgs(node, ctx.investorA.address, true, now, false);
    });
  });

  describe("revocation by node, not by address", function () {
    it("revokes the previous owner even when the update's owner is the zero address", async function () {
      // This is the scenario the whole design exists for: an expired ENS
      // name has no owner (the registry masks it), so the beacon's
      // revocation message carries owner == address(0). The only way to know
      // WHO to deauthorize is the mirror's own memory of who the node was
      // last bound to.
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investorc");
      const t0 = BigInt(await time.latest());

      await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);

      await deliverAt(ctx, t0 + 20n, {
        node,
        owner: hre.ethers.ZeroAddress,
        authorized: false,
        kyc: "",
      });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });

    it("revokes the previous owner when the name is blocked but still has a (different) owner", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investorb");
      const t0 = BigInt(await time.latest());

      await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });
      await deliverAt(ctx, t0 + 20n, {
        node,
        owner: ctx.investorA.address,
        authorized: false,
        kyc: "pending",
      });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });

    it("re-authorizing a node for a NEW owner deauthorizes the previous one", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const t0 = BigInt(await time.latest());

      await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });
      await deliverAt(ctx, t0 + 20n, { node, owner: ctx.investorB.address, authorized: true });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(true);
    });

    it("re-confirming the SAME owner does not deauthorize them", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const t0 = BigInt(await time.latest());

      await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });
      await deliverAt(ctx, t0 + 20n, { node, owner: ctx.investorA.address, authorized: true });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("does not touch an unrelated address's authorization when a different node is revoked", async function () {
      const ctx = await loadFixture(deployFixture);
      const t0 = BigInt(await time.latest());

      await deliverAt(ctx, t0 + 10n, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
      });
      await deliverAt(ctx, t0 + 10n, {
        node: nodeFor("investorb"),
        owner: ctx.investorB.address,
        authorized: true,
      });
      await deliverAt(ctx, t0 + 20n, {
        node: nodeFor("investorb"),
        owner: hre.ethers.ZeroAddress,
        authorized: false,
      });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(false);
    });
  });

  describe("ordering / replay protection", function () {
    it("drops an update with an equal timestamp rather than reverting", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const t = BigInt(await time.latest()) + 10n;

      await deliverAt(ctx, t, { node, owner: ctx.investorA.address, authorized: true });
      // A CCIP retry or duplicate delivery of the exact same message. Out-of-
      // order execution means this can genuinely happen and is not an
      // attack, so it must not revert — reverting would mark a harmless
      // duplicate as FAILED on the CCIP explorer.
      await expect(deliverAt(ctx, t, { node, owner: ctx.investorB.address, authorized: true })).to.not
        .be.reverted;

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(false);
    });

    it("drops an update with an older timestamp than one already applied", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const t = BigInt(await time.latest());

      await deliverAt(ctx, t + 30n, { node, owner: ctx.investorA.address, authorized: true });
      // Out-of-order delivery: an older message arrives after a newer one.
      await deliverAt(ctx, t + 20n, { node, owner: hre.ethers.ZeroAddress, authorized: false });

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("emits StaleUpdateDropped instead of ComplianceApplied for a stale update", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const t = BigInt(await time.latest()) + 10n;

      await deliverAt(ctx, t, { node, owner: ctx.investorA.address, authorized: true });
      const tx = deliverAt(ctx, t, { node, owner: ctx.investorA.address, authorized: true });

      await expect(tx).to.emit(ctx.mirror, "StaleUpdateDropped").withArgs(node, t, t);
      await expect(tx).to.not.emit(ctx.mirror, "ComplianceApplied");
    });

    it("tracks ordering independently per node", async function () {
      const ctx = await loadFixture(deployFixture);
      const t = BigInt(await time.latest());
      await deliverAt(ctx, t + 500n, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
      });
      // investora's history must not affect what counts as stale for
      // investorb — an EARLIER timestamp for a DIFFERENT node is fine.
      await expect(
        deliverAt(ctx, t + 100n, { node: nodeFor("investorb"), owner: ctx.investorB.address, authorized: true }),
      ).to.not.be.reverted;
      expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(true);
    });
  });

  describe("staleness decay", function () {
    it("authorizes immediately after a fresh message", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, { node: nodeFor("investora"), owner: ctx.investorA.address, authorized: true });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("stays authorized just under the staleness window", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, { node: nodeFor("investora"), owner: ctx.investorA.address, authorized: true });
      await time.increase(Number(MAX_STALENESS) - 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("goes stale on its own once maxStaleness elapses, with no new update", async function () {
      const ctx = await loadFixture(deployFixture);
      await deliver(ctx, { node: nodeFor("investora"), owner: ctx.investorA.address, authorized: true });
      await time.increase(Number(MAX_STALENESS) + 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });

    it("treats exactly maxStaleness elapsed as still fresh (<=, matching the contract's own comparison)", async function () {
      const ctx = await loadFixture(deployFixture);
      const sourceTimestamp = BigInt(await time.latest());
      await deliverAt(ctx, sourceTimestamp, {
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
      });
      await time.increaseTo(sourceTimestamp + MAX_STALENESS);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("a fresh re-publish resets the staleness clock", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const t0 = BigInt(await time.latest());
      await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });

      await time.increase(Number(MAX_STALENESS) - 10);
      await deliver(ctx, { node, owner: ctx.investorA.address, authorized: true });

      await time.increase(Number(MAX_STALENESS) - 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("staleness() reports elapsed seconds, and max uint if never authorized", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mirror.staleness(ctx.investorA.address)).to.equal(2n ** 256n - 1n);

      await deliver(ctx, { node: nodeFor("investora"), owner: ctx.investorA.address, authorized: true });
      await time.increase(30);
      const elapsed = await ctx.mirror.staleness(ctx.investorA.address);
      expect(elapsed).to.be.at.least(30n);
      expect(elapsed).to.be.lessThan(MAX_STALENESS);
    });

    it("does not revive a revoked address once it goes stale — revocation is not merely a staleness reset", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const t0 = BigInt(await time.latest());
      await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });
      await deliverAt(ctx, t0 + 20n, {
        node,
        owner: ctx.investorA.address,
        authorized: false,
        kyc: "pending",
      });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);

      await time.increase(Number(MAX_STALENESS) * 10);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });
  });

  describe("isAuthorized never reverts on a future-dated timestamp", function () {
    // Found live: a stored authorizedAt ahead of block.timestamp made the
    // plain subtraction in isAuthorized underflow and REVERT, which would
    // brick every transfer check touching that address on the whole bond —
    // a much worse failure than a merely-generous boolean answer.
    it("treats an authorization from a not-yet-reached timestamp as fresh, not reverting", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const future = BigInt(await time.latest()) + 1000n;

      // Deliver without advancing the clock — the stored authorizedAt ends
      // up strictly ahead of block.timestamp at the moment isAuthorized is
      // read back, which used to underflow.
      const data = encodePayload({
        node,
        owner: ctx.investorA.address,
        authorized: true,
        sourceTimestamp: future,
      });
      const message = ccipMessage({ sender: ctx.beaconSender.address, data });
      await ctx.mirror.connect(ctx.router).ccipReceive(message);

      await expect(ctx.mirror.isAuthorized(ctx.investorA.address)).to.not.be.reverted;
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("staleness() returns 0 rather than underflowing for the same case", async function () {
      const ctx = await loadFixture(deployFixture);
      const future = BigInt(await time.latest()) + 1000n;
      const data = encodePayload({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        sourceTimestamp: future,
      });
      const message = ccipMessage({ sender: ctx.beaconSender.address, data });
      await ctx.mirror.connect(ctx.router).ccipReceive(message);

      expect(await ctx.mirror.staleness(ctx.investorA.address)).to.equal(0n);
    });
  });

  describe("EIP-712 attestation fallback", function () {
    it("hashComplianceAttestation matches an independently computed EIP-712 digest", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const domain = await domainFor(ctx.mirror);
      const expected = hre.ethers.TypedDataEncoder.hash(domain, ATTESTATION_TYPES, value);
      const onChain = await ctx.mirror.hashComplianceAttestation(value);
      expect(onChain).to.equal(expected);
    });

    it("applies an authorization from exactly threshold signers", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);

      await ctx.mirror.connect(ctx.stranger).submitAttestation(value, signatures);
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
    });

    it("is permissionless — anyone holding a valid signature set may submit it", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer2, ctx.signer3], value);
      // Submitted by a stranger who signed nothing themselves.
      await expect(ctx.mirror.connect(ctx.stranger).submitAttestation(value, signatures)).to.not.be
        .reverted;
    });

    it("emits ComplianceApplied with viaAttestation=true", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investora");
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({ node, owner: ctx.investorA.address, authorized: true, attestedAt });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);

      await expect(ctx.mirror.submitAttestation(value, signatures))
        .to.emit(ctx.mirror, "ComplianceApplied")
        .withArgs(node, ctx.investorA.address, true, attestedAt, true);
    });

    it("rejects fewer than threshold signatures", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1], value);

      await expect(ctx.mirror.submitAttestation(value, signatures))
        .to.be.revertedWithCustomError(ctx.mirror, "NotEnoughValidSignatures")
        .withArgs(1, 2);
    });

    it("rejects a signature from an address that is not a configured signer", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      // signer1 is legitimate; stranger is not configured at all.
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.stranger], value);

      await expect(ctx.mirror.submitAttestation(value, signatures)).to.be.revertedWithCustomError(
        ctx.mirror,
        "UnknownSigner",
      );
    });

    it("rejects the same signer's signature counted twice toward the threshold", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const domain = await domainFor(ctx.mirror);
      const sig = await ctx.signer1.signTypedData(domain, ATTESTATION_TYPES, value);

      // The same signature submitted twice cannot satisfy a 2-of-3 threshold.
      await expect(
        ctx.mirror.submitAttestation(value, [sig, sig]),
      ).to.be.revertedWithCustomError(ctx.mirror, "SignaturesNotSortedOrDuplicate");
    });

    it("rejects signatures submitted out of sorted order", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const sorted = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);
      const reversed = [sorted[1], sorted[0]];

      await expect(
        ctx.mirror.submitAttestation(value, reversed),
      ).to.be.revertedWithCustomError(ctx.mirror, "SignaturesNotSortedOrDuplicate");
    });

    it("rejects a signature over a different node than the one submitted", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const signedValue = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], signedValue);

      // Submitting the signatures against a DIFFERENT node than what was
      // actually signed must recover the wrong (unconfigured) address, not
      // silently accept a signature for something else.
      const tamperedValue = { ...signedValue, node: nodeFor("investorb") };
      await expect(
        ctx.mirror.submitAttestation(tamperedValue, signatures),
      ).to.be.revertedWithCustomError(ctx.mirror, "UnknownSigner");
    });

    it("rejects an attestation claiming authorized=true with a zero owner", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: hre.ethers.ZeroAddress,
        authorized: true,
        attestedAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);
      await expect(ctx.mirror.submitAttestation(value, signatures)).to.be.revertedWithCustomError(
        ctx.mirror,
        "ZeroAddress",
      );
    });

    it("rejects an attestation older than the validity window", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);

      await time.increase(Number(ATTESTATION_WINDOW) + 10);
      await expect(
        ctx.mirror.submitAttestation(value, signatures),
      ).to.be.revertedWithCustomError(ctx.mirror, "AttestationTooOld");
    });

    it("rejects an attestation claiming a timestamp too far in the future", async function () {
      const ctx = await loadFixture(deployFixture);
      const future = BigInt(await time.latest()) + ATTESTATION_WINDOW + 100n;
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt: future,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);
      await expect(
        ctx.mirror.submitAttestation(value, signatures),
      ).to.be.revertedWithCustomError(ctx.mirror, "AttestationTooFarInFuture");
    });

    it("accepts an attestation right at the edge of the validity window", async function () {
      const ctx = await loadFixture(deployFixture);
      const attestedAt = BigInt(await time.latest());
      const value = attestationValue({
        node: nodeFor("investora"),
        owner: ctx.investorA.address,
        authorized: true,
        attestedAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);

      await time.increase(Number(ATTESTATION_WINDOW) - 5);
      await expect(ctx.mirror.submitAttestation(value, signatures)).to.not.be.reverted;
    });

    it("can revoke by node exactly like the CCIP path — carrying a zero owner", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = nodeFor("investorc");
      const t0 = BigInt(await time.latest());

      // Authorize via CCIP first.
      await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });
      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);

      // Revoke via attestation, with the expired-name shape (owner masked to
      // zero) — proving the SAME boundOwner bookkeeping serves both paths.
      const revokeAt = t0 + 20n;
      const value = attestationValue({
        node,
        owner: hre.ethers.ZeroAddress,
        authorized: false,
        kyc: "",
        attestedAt: revokeAt,
      });
      const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer3], value);
      await time.increaseTo(revokeAt);
      await ctx.mirror.submitAttestation(value, signatures);

      expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
    });

    describe("interaction with the CCIP path on the shared timestamp axis", function () {
      it("an attestation authorizes ahead of a CCIP message still in flight", async function () {
        // The actual use case: publish() was called on Sepolia (an OLDER
        // sourceTimestamp is now "in flight" across CCIP), and while waiting
        // for delivery, a fresher attestation is submitted directly.
        const ctx = await loadFixture(deployFixture);
        const node = nodeFor("investora");
        const t0 = BigInt(await time.latest());

        const attestedAt = t0 + 50n; // "now", fresher than the pending CCIP message
        const value = attestationValue({ node, owner: ctx.investorA.address, authorized: true, attestedAt });
        const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);
        await time.increaseTo(attestedAt);
        await ctx.mirror.submitAttestation(value, signatures);
        expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);

        // The CCIP message that was actually "in flight" the whole time,
        // carrying an OLDER sourceTimestamp from before the attestation.
        await deliverAt(ctx, t0 + 10n, { node, owner: ctx.investorA.address, authorized: true });
        // Still authorized — the stale CCIP message changed nothing.
        expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);
      });

      it("a subsequent, fresher CCIP message supersedes an earlier attestation", async function () {
        // The attestation can never permanently entrench a claim: once the
        // real message lands with a newer timestamp, it wins.
        const ctx = await loadFixture(deployFixture);
        const node = nodeFor("investora");
        const t0 = BigInt(await time.latest());

        const attestedAt = t0 + 10n;
        const value = attestationValue({ node, owner: ctx.investorA.address, authorized: true, attestedAt });
        const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);
        await time.increaseTo(attestedAt);
        await ctx.mirror.submitAttestation(value, signatures);
        expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(true);

        // A freshly re-read CCIP message, sent AFTER the attestation, says
        // the investor is now blocked.
        await deliverAt(ctx, t0 + 50n, {
          node,
          owner: ctx.investorA.address,
          authorized: false,
          kyc: "pending",
        });
        expect(await ctx.mirror.isAuthorized(ctx.investorA.address)).to.equal(false);
      });

      it("an attestation for one node does not affect ordering for another", async function () {
        const ctx = await loadFixture(deployFixture);
        const t0 = BigInt(await time.latest());

        const attestedAt = t0 + 500n;
        const value = attestationValue({
          node: nodeFor("investora"),
          owner: ctx.investorA.address,
          authorized: true,
          attestedAt,
        });
        const signatures = await signSorted(ctx.mirror, [ctx.signer1, ctx.signer2], value);
        await time.increaseTo(attestedAt);
        await ctx.mirror.submitAttestation(value, signatures);

        // investorb's CCIP message has an EARLIER timestamp than investora's
        // attestation, but that is irrelevant — different node.
        await expect(
          deliverAt(ctx, t0 + 100n, { node: nodeFor("investorb"), owner: ctx.investorB.address, authorized: true }),
        ).to.not.be.reverted;
        expect(await ctx.mirror.isAuthorized(ctx.investorB.address)).to.equal(true);
      });
    });
  });
});
