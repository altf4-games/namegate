// Hardhat/mocha contract tests. Run with: npm run test:contracts
//
// These run against test doubles on a local network (see
// contracts/test/BeaconTestDoubles.sol for why, and for what they do not
// prove). They cover the beacon's own decision logic and its money handling.
// Proof that it reads real ENS and reaches real Hedera comes from deploying
// it to Sepolia and running ens/scripts/11-beacon-publish.ts, not from here.

import { expect } from "chai";
import hre from "hardhat";

const PARENT_NODE = hre.ethers.namehash("namegate.eth");
const HEDERA_SELECTOR = 222782988166878823n;
const FEE = hre.ethers.parseEther("0.01");

// Far enough out that these never expire mid-test.
const FUTURE_EXPIRY = 4_102_444_800n; // 2100-01-01

async function deployFixture(fee = FEE) {
  const [deployer, investor, stranger] = await hre.ethers.getSigners();

  const registry = await hre.ethers.deployContract("FakeEnsRegistry");
  const resolver = await hre.ethers.deployContract("FakeTextResolver");
  const router = await hre.ethers.deployContract("FakeCcipRouter", [fee]);

  const beacon = await hre.ethers.deployContract("ENSComplianceBeacon", [
    await registry.getAddress(),
    PARENT_NODE,
    await router.getAddress(),
    HEDERA_SELECTOR,
    // Stand-in for the Hedera control list; the local router never delivers.
    stranger.address,
  ]);

  return { deployer, investor, stranger, registry, resolver, router, beacon };
}

function nodeFor(label) {
  return hre.ethers.keccak256(
    hre.ethers.concat([PARENT_NODE, hre.ethers.keccak256(hre.ethers.toUtf8Bytes(label))]),
  );
}

async function registerVerified(ctx, label, overrides = {}) {
  const node = nodeFor(label);
  await ctx.registry.setEntry(label, await ctx.resolver.getAddress(), overrides.expiry ?? FUTURE_EXPIRY);
  await ctx.resolver.setText(node, "compliance.kyc", overrides.kyc ?? "verified");
  await ctx.resolver.setText(node, "compliance.jurisdiction", overrides.jurisdiction ?? "US");
  await ctx.resolver.setText(
    node,
    "compliance.accreditation-expiry",
    overrides.accreditationExpiry ?? "2027-03-01",
  );
  await ctx.resolver.setText(node, "compliance.lockup-until", overrides.lockupUntil ?? "");
  return node;
}

describe("ENSComplianceBeacon", function () {
  describe("deployment", function () {
    it("stores the constructor wiring", async function () {
      const ctx = await deployFixture();
      expect(await ctx.beacon.registry()).to.equal(await ctx.registry.getAddress());
      expect(await ctx.beacon.parentNode()).to.equal(PARENT_NODE);
      expect(await ctx.beacon.router()).to.equal(await ctx.router.getAddress());
      expect(await ctx.beacon.destinationChainSelector()).to.equal(HEDERA_SELECTOR);
    });

    it("rejects a zero registry, router, or receiver", async function () {
      const [, , stranger] = await hre.ethers.getSigners();
      const registry = await hre.ethers.deployContract("FakeEnsRegistry");
      const router = await hre.ethers.deployContract("FakeCcipRouter", [FEE]);
      const Beacon = await hre.ethers.getContractFactory("ENSComplianceBeacon");
      const zero = hre.ethers.ZeroAddress;

      await expect(
        Beacon.deploy(zero, PARENT_NODE, await router.getAddress(), HEDERA_SELECTOR, stranger.address),
      ).to.be.revertedWithCustomError(Beacon, "ZeroAddress");

      await expect(
        Beacon.deploy(await registry.getAddress(), PARENT_NODE, zero, HEDERA_SELECTOR, stranger.address),
      ).to.be.revertedWithCustomError(Beacon, "ZeroAddress");

      await expect(
        Beacon.deploy(
          await registry.getAddress(),
          PARENT_NODE,
          await router.getAddress(),
          HEDERA_SELECTOR,
          zero,
        ),
      ).to.be.revertedWithCustomError(Beacon, "ZeroAddress");
    });
  });

  describe("nodeFor", function () {
    it("matches ENSIP-1 namehash for a subname of the parent", async function () {
      const ctx = await deployFixture();
      // Computed independently by ethers' own namehash, not by reimplementing
      // the beacon's formula — if both were wrong the same way this would
      // pass, so the value is also cross-checked against viem in
      // ens/test/beaconNode.test.ts.
      expect(await ctx.beacon.nodeFor("investora")).to.equal(
        hre.ethers.namehash("investora.namegate.eth"),
      );
    });

    it("gives different nodes for different labels", async function () {
      const ctx = await deployFixture();
      expect(await ctx.beacon.nodeFor("investora")).to.not.equal(
        await ctx.beacon.nodeFor("investorb"),
      );
    });
  });

  describe("readCompliance", function () {
    it("reports authorized for a verified, unexpired name", async function () {
      const ctx = await deployFixture();
      const node = await registerVerified(ctx, "investora");

      const record = await ctx.beacon.readCompliance("investora");
      expect(record.authorized).to.equal(true);
      expect(record.node).to.equal(node);
      expect(record.resolver).to.equal(await ctx.resolver.getAddress());
      expect(record.kyc).to.equal("verified");
      expect(record.jurisdiction).to.equal("US");
      expect(record.accreditationExpiry).to.equal("2027-03-01");
      expect(record.nameExpiry).to.equal(FUTURE_EXPIRY);
    });

    it("reports unauthorized when KYC is not exactly 'verified'", async function () {
      const ctx = await deployFixture();
      for (const kyc of ["pending", "rejected", "Verified", "VERIFIED", "verified ", ""]) {
        await registerVerified(ctx, "investorb", { kyc });
        const record = await ctx.beacon.readCompliance("investorb");
        expect(record.authorized, `expected "${kyc}" to be unauthorized`).to.equal(false);
      }
    });

    it("reports unauthorized with a zero resolver once the name has expired", async function () {
      const ctx = await deployFixture();
      const soon = BigInt(await time()) + 120n;
      await registerVerified(ctx, "investorc", { expiry: soon });

      expect((await ctx.beacon.readCompliance("investorc")).authorized).to.equal(true);

      await hre.network.provider.send("evm_increaseTime", [200]);
      await hre.network.provider.send("evm_mine");

      const record = await ctx.beacon.readCompliance("investorc");
      // This is the design point: expiry is not a date string comparison in
      // the beacon. The registry stops resolving, so the record becomes
      // structurally unreadable.
      expect(record.resolver).to.equal(hre.ethers.ZeroAddress);
      expect(record.authorized).to.equal(false);
      expect(record.kyc).to.equal("");
      // The expiry itself is still reported, so a caller can tell "expired"
      // apart from "never registered".
      expect(record.nameExpiry).to.equal(soon);
    });

    it("reports unauthorized and a zero expiry for a name that was never registered", async function () {
      const ctx = await deployFixture();
      const record = await ctx.beacon.readCompliance("nobody");
      expect(record.resolver).to.equal(hre.ethers.ZeroAddress);
      expect(record.authorized).to.equal(false);
      expect(record.nameExpiry).to.equal(0n);
    });

    it("rejects an empty label", async function () {
      const ctx = await deployFixture();
      await expect(ctx.beacon.readCompliance("")).to.be.revertedWithCustomError(
        ctx.beacon,
        "EmptyLabel",
      );
    });
  });

  describe("publish", function () {
    it("sends a CCIP message carrying the decision and evidence", async function () {
      const ctx = await deployFixture();
      const node = await registerVerified(ctx, "investora");

      await ctx.beacon.publish("investora", ctx.investor.address, { value: FEE });

      expect(await ctx.router.sendCount()).to.equal(1n);
      expect(await ctx.router.lastDestinationChainSelector()).to.equal(HEDERA_SELECTOR);
      expect(await ctx.router.lastReceiver()).to.equal(ctx.stranger.address);

      const decoded = hre.ethers.AbiCoder.defaultAbiCoder().decode(
        ["bytes32", "address", "bool", "string", "string", "string", "string", "uint64", "uint256", "uint256"],
        await ctx.router.lastData(),
      );
      expect(decoded[0]).to.equal(node);
      expect(decoded[1]).to.equal(ctx.investor.address);
      expect(decoded[2]).to.equal(true);
      expect(decoded[3]).to.equal("verified");
      expect(decoded[4]).to.equal("US");
      // Carried as evidence even though `authorized` does not consider them,
      // so the Hedera side can enforce them later without a new wire format.
      expect(decoded[5]).to.equal("2027-03-01");
      expect(decoded[6]).to.equal("");
      expect(decoded[7]).to.equal(FUTURE_EXPIRY);
      expect(decoded[8]).to.be.greaterThan(0n); // source block number
      expect(decoded[9]).to.be.greaterThan(0n); // source timestamp
    });

    it("publishes an unauthorized verdict rather than reverting on a blocked investor", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investorb", { kyc: "pending" });

      await ctx.beacon.publish("investorb", ctx.investor.address, { value: FEE });

      const decoded = hre.ethers.AbiCoder.defaultAbiCoder().decode(
        ["bytes32", "address", "bool", "string", "string", "string", "string", "uint64", "uint256", "uint256"],
        await ctx.router.lastData(),
      );
      // Revoking has to be publishable, or a name could never be un-authorized
      // downstream.
      expect(decoded[2]).to.equal(false);
      expect(decoded[3]).to.equal("pending");
    });

    it("is permissionless — a stranger can publish someone else's name", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");

      await ctx.beacon
        .connect(ctx.stranger)
        .publish("investora", ctx.investor.address, { value: FEE });

      expect(await ctx.router.sendCount()).to.equal(1n);
    });

    it("emits CompliancePublished with the decision and fee", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");

      await expect(ctx.beacon.publish("investora", ctx.investor.address, { value: FEE }))
        .to.emit(ctx.beacon, "CompliancePublished")
        .withArgs(await ctx.router.nextMessageId(), "investora", ctx.investor.address, true, FEE);
    });

    it("reverts when the fee is underpaid, naming what was required", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");

      await expect(
        ctx.beacon.publish("investora", ctx.investor.address, { value: FEE - 1n }),
      )
        .to.be.revertedWithCustomError(ctx.beacon, "InsufficientFee")
        .withArgs(FEE, FEE - 1n);
    });

    it("refunds overpayment and keeps no balance", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");

      const overpay = FEE * 3n;
      const before = await hre.ethers.provider.getBalance(ctx.deployer.address);
      const tx = await ctx.beacon.publish("investora", ctx.investor.address, { value: overpay });
      const receipt = await tx.wait();
      const after = await hre.ethers.provider.getBalance(ctx.deployer.address);

      const gasCost = receipt.gasUsed * receipt.gasPrice;
      // Only the fee should have left the caller's balance, not the overpay.
      expect(before - after - gasCost).to.equal(FEE);
      expect(await hre.ethers.provider.getBalance(await ctx.beacon.getAddress())).to.equal(0n);
      expect(await ctx.router.lastValue()).to.equal(FEE);
    });

    it("rejects a zero investor address", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");

      await expect(
        ctx.beacon.publish("investora", hre.ethers.ZeroAddress, { value: FEE }),
      ).to.be.revertedWithCustomError(ctx.beacon, "ZeroAddress");
    });

    it("reverts the whole call when the refund cannot be delivered", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");
      const rejecter = await hre.ethers.deployContract("RefundRejecter");

      // Overpaying from a contract with no receive function must not silently
      // strand the excess in the beacon.
      await expect(
        rejecter.publish(await ctx.beacon.getAddress(), "investora", ctx.investor.address, {
          value: FEE * 2n,
        }),
      ).to.be.revertedWith("refund failed");

      expect(await hre.ethers.provider.getBalance(await ctx.beacon.getAddress())).to.equal(0n);
    });
  });

  describe("quote", function () {
    it("returns the router's fee", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");
      expect(await ctx.beacon.quote("investora", ctx.investor.address)).to.equal(FEE);
    });

    it("tracks a fee change, so callers cannot rely on a stale quote", async function () {
      const ctx = await deployFixture();
      await registerVerified(ctx, "investora");
      await ctx.router.setFee(FEE * 2n);
      expect(await ctx.beacon.quote("investora", ctx.investor.address)).to.equal(FEE * 2n);
    });
  });
});

async function time() {
  const block = await hre.ethers.provider.getBlock("latest");
  return block.timestamp;
}
