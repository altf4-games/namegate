// Hardhat/mocha contract tests. Run with: npm run test:contracts
//
// These run against test doubles on a local network (see
// contracts/test/BeaconTestDoubles.sol for why, and for what they do not
// prove). They cover the beacon's own decision logic and its money handling.
// Proof that it reads real ENS and reaches real Hedera comes from deploying
// it to Sepolia and running ens/scripts/11-beacon-publish.ts, not from here.

import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const PARENT_NODE = hre.ethers.namehash("namegate.eth");
const HEDERA_SELECTOR = 222782988166878823n;
const FEE = hre.ethers.parseEther("0.01");
const GAS_LIMIT = 300_000n;

// Far enough out that these never expire mid-test.
const FUTURE_EXPIRY = 4_102_444_800n; // 2100-01-01

async function deployFixture() {
  const [deployer, investor, stranger, hederaReceiver] = await hre.ethers.getSigners();

  const registry = await hre.ethers.deployContract("FakeEnsRegistry");
  const resolver = await hre.ethers.deployContract("FakeTextResolver");
  const rogueResolver = await hre.ethers.deployContract("FakeTextResolver");
  const router = await hre.ethers.deployContract("FakeCcipRouter", [FEE]);

  const beacon = await hre.ethers.deployContract("ENSComplianceBeacon", [
    await registry.getAddress(),
    PARENT_NODE,
    await resolver.getAddress(),
    await router.getAddress(),
    HEDERA_SELECTOR,
    hederaReceiver.address,
    GAS_LIMIT,
  ]);

  return {
    deployer,
    investor,
    stranger,
    hederaReceiver,
    registry,
    resolver,
    rogueResolver,
    router,
    beacon,
  };
}

function nodeFor(label) {
  return hre.ethers.keccak256(
    hre.ethers.concat([PARENT_NODE, hre.ethers.keccak256(hre.ethers.toUtf8Bytes(label))]),
  );
}

const PAYLOAD_TYPES = [
  "bytes32", // node
  "address", // owner
  "bool", // authorized
  "string", // kyc
  "string", // jurisdiction
  "string", // accreditation-expiry
  "string", // lockup-until
  "uint64", // lockup parsed to a timestamp
  "uint64", // registry expiry
  "uint256", // source block
  "uint256", // source timestamp
];

function decodePayload(data) {
  const d = hre.ethers.AbiCoder.defaultAbiCoder().decode(PAYLOAD_TYPES, data);
  return {
    node: d[0],
    owner: d[1],
    authorized: d[2],
    kyc: d[3],
    jurisdiction: d[4],
    accreditationExpiry: d[5],
    lockupUntil: d[6],
    lockupUntilTimestamp: d[7],
    nameExpiry: d[8],
    sourceBlock: d[9],
    sourceTimestamp: d[10],
  };
}

/** Registers `label` on the trusted resolver, owned by ctx.investor. */
async function registerVerified(ctx, label, overrides = {}) {
  const node = nodeFor(label);
  const resolver = overrides.resolver ?? (await ctx.resolver.getAddress());
  await ctx.registry.setEntry(
    label,
    resolver,
    overrides.owner ?? ctx.investor.address,
    overrides.expiry ?? FUTURE_EXPIRY,
  );
  const target = overrides.resolverContract ?? ctx.resolver;
  await target.setText(node, "compliance.kyc", overrides.kyc ?? "verified");
  await target.setText(node, "compliance.jurisdiction", overrides.jurisdiction ?? "US");
  await target.setText(
    node,
    "compliance.accreditation-expiry",
    overrides.accreditationExpiry ?? "2027-03-01",
  );
  await target.setText(node, "compliance.lockup-until", overrides.lockupUntil ?? "");
  return node;
}

describe("ENSComplianceBeacon", function () {
  describe("deployment", function () {
    it("stores the constructor wiring", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.beacon.registry()).to.equal(await ctx.registry.getAddress());
      expect(await ctx.beacon.parentNode()).to.equal(PARENT_NODE);
      expect(await ctx.beacon.expectedResolver()).to.equal(await ctx.resolver.getAddress());
      expect(await ctx.beacon.router()).to.equal(await ctx.router.getAddress());
      expect(await ctx.beacon.destinationChainSelector()).to.equal(HEDERA_SELECTOR);
      expect(await ctx.beacon.destinationGasLimit()).to.equal(GAS_LIMIT);
    });

    it("rejects a zero registry, resolver, router, or receiver", async function () {
      const ctx = await loadFixture(deployFixture);
      const Beacon = await hre.ethers.getContractFactory("ENSComplianceBeacon");
      const good = [
        await ctx.registry.getAddress(),
        PARENT_NODE,
        await ctx.resolver.getAddress(),
        await ctx.router.getAddress(),
        HEDERA_SELECTOR,
        ctx.hederaReceiver.address,
        GAS_LIMIT,
      ];

      for (const index of [0, 2, 3, 5]) {
        const args = [...good];
        args[index] = hre.ethers.ZeroAddress;
        await expect(Beacon.deploy(...args), `arg ${index}`).to.be.revertedWithCustomError(
          Beacon,
          "ZeroAddress",
        );
      }
    });

    it("rejects a zero destination gas limit", async function () {
      const ctx = await loadFixture(deployFixture);
      const Beacon = await hre.ethers.getContractFactory("ENSComplianceBeacon");
      await expect(
        Beacon.deploy(
          await ctx.registry.getAddress(),
          PARENT_NODE,
          await ctx.resolver.getAddress(),
          await ctx.router.getAddress(),
          HEDERA_SELECTOR,
          ctx.hederaReceiver.address,
          0,
        ),
      ).to.be.revertedWithCustomError(Beacon, "ZeroGasLimit");
    });
  });

  describe("nodeFor", function () {
    it("matches ENSIP-1 namehash for a subname of the parent", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.beacon.nodeFor("investora")).to.equal(
        hre.ethers.namehash("investora.namegate.eth"),
      );
    });

    it("gives different nodes for different labels", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.beacon.nodeFor("investora")).to.not.equal(
        await ctx.beacon.nodeFor("investorb"),
      );
    });
  });

  describe("readCompliance", function () {
    it("reports authorized for a verified, unexpired name on the trusted resolver", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = await registerVerified(ctx, "investora");

      const record = await ctx.beacon.readCompliance("investora");
      expect(record.authorized).to.equal(true);
      expect(record.node).to.equal(node);
      expect(record.owner).to.equal(ctx.investor.address);
      expect(record.resolver).to.equal(await ctx.resolver.getAddress());
      expect(record.kyc).to.equal("verified");
      expect(record.jurisdiction).to.equal("US");
      expect(record.accreditationExpiry).to.equal("2027-03-01");
      expect(record.nameExpiry).to.equal(FUTURE_EXPIRY);
    });

    it("reports unauthorized when KYC is not exactly 'verified'", async function () {
      const ctx = await loadFixture(deployFixture);
      for (const kyc of ["pending", "rejected", "Verified", "VERIFIED", "verified ", ""]) {
        await registerVerified(ctx, "investorb", { kyc });
        const record = await ctx.beacon.readCompliance("investorb");
        expect(record.authorized, `expected "${kyc}" to be unauthorized`).to.equal(false);
      }
    });

    it("refuses to believe a resolver the beacon was not pinned to", async function () {
      const ctx = await loadFixture(deployFixture);
      // The investor repoints their name at a resolver they control and
      // writes themselves a passing KYC status. Withholding ROLE_SET_RESOLVER
      // is supposed to make this impossible; pinning the resolver means that
      // even if it did happen, the beacon would not believe it.
      await registerVerified(ctx, "investorf", {
        resolver: await ctx.rogueResolver.getAddress(),
        resolverContract: ctx.rogueResolver,
        kyc: "verified",
      });

      const record = await ctx.beacon.readCompliance("investorf");
      expect(record.resolver).to.equal(await ctx.rogueResolver.getAddress());
      expect(record.authorized).to.equal(false);
      // Records from an untrusted resolver are not even read.
      expect(record.kyc).to.equal("");
    });

    it("reports unauthorized with a zero resolver once the name has expired", async function () {
      const ctx = await loadFixture(deployFixture);
      const soon = BigInt(await time.latest()) + 120n;
      await registerVerified(ctx, "investorc", { expiry: soon });

      expect((await ctx.beacon.readCompliance("investorc")).authorized).to.equal(true);

      await time.increaseTo(soon + 1n);

      const record = await ctx.beacon.readCompliance("investorc");
      // This is the design point: expiry is not a date string comparison in
      // the beacon. The registry stops resolving, so the record becomes
      // structurally unreadable.
      expect(record.resolver).to.equal(hre.ethers.ZeroAddress);
      expect(record.authorized).to.equal(false);
      expect(record.kyc).to.equal("");
      // The owner is masked on expiry too, which is exactly why the receiver
      // has to revoke by node rather than by the address in the payload.
      expect(record.owner).to.equal(hre.ethers.ZeroAddress);
      // The expiry itself is still reported, so a caller can tell "expired"
      // apart from "never registered".
      expect(record.nameExpiry).to.equal(soon);
    });

    it("reports unauthorized and a zero expiry for a name that was never registered", async function () {
      const ctx = await loadFixture(deployFixture);
      const record = await ctx.beacon.readCompliance("nobody");
      expect(record.resolver).to.equal(hre.ethers.ZeroAddress);
      expect(record.owner).to.equal(hre.ethers.ZeroAddress);
      expect(record.authorized).to.equal(false);
      expect(record.nameExpiry).to.equal(0n);
    });

    it("never authorizes a name with no owner", async function () {
      const ctx = await loadFixture(deployFixture);
      // Everything else passes; only the owner is missing. A verdict with
      // nobody to bind it to must not be true.
      await registerVerified(ctx, "investorg", { owner: hre.ethers.ZeroAddress });
      const record = await ctx.beacon.readCompliance("investorg");
      expect(record.kyc).to.equal("verified");
      expect(record.authorized).to.equal(false);
    });

    it("blocks a verified investor who is still inside their lockup", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora", { lockupUntil: "2099-01-01" });

      const record = await ctx.beacon.readCompliance("investora");
      expect(record.kyc).to.equal("verified");
      expect(record.authorized).to.equal(false);
      expect(record.lockupUntilTimestamp).to.equal(BigInt(Date.UTC(2099, 0, 1) / 1000));
    });

    it("authorizes a verified investor whose lockup has already lapsed", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora", { lockupUntil: "2020-01-01" });
      expect((await ctx.beacon.readCompliance("investora")).authorized).to.equal(true);
    });

    it("treats an unset lockup as no lockup", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora", { lockupUntil: "" });

      const record = await ctx.beacon.readCompliance("investora");
      expect(record.lockupUntilTimestamp).to.equal(0n);
      expect(record.authorized).to.equal(true);
    });

    it("blocks on a malformed lockup rather than ignoring it", async function () {
      const ctx = await loadFixture(deployFixture);
      // Fail-closed: a typo in a compliance record must never authorize.
      for (const lockupUntil of ["not-a-date", "2026/12/31", "2027-02-30", "12-31-2026"]) {
        await registerVerified(ctx, "investora", { lockupUntil });
        const record = await ctx.beacon.readCompliance("investora");
        expect(record.authorized, `expected "${lockupUntil}" to block`).to.equal(false);
        expect(record.lockupUntilTimestamp).to.equal(2n ** 64n - 1n);
      }
    });

    it("requires BOTH verified KYC and a lapsed lockup", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora", { kyc: "pending", lockupUntil: "2020-01-01" });
      expect((await ctx.beacon.readCompliance("investora")).authorized).to.equal(false);
    });

    it("rejects an empty label", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.beacon.readCompliance("")).to.be.revertedWithCustomError(
        ctx.beacon,
        "EmptyLabel",
      );
    });
  });

  describe("publish", function () {
    it("binds the verdict to the registry's owner, never to the caller", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");

      // A stranger pays the fee. The verdict must still bind to the holder.
      // An earlier API took the address as an argument, which let anyone
      // publish a compliant name's `true` verdict bound to themselves — a
      // complete bypass of the compliance layer for the price of the fee.
      await ctx.beacon.connect(ctx.stranger).publish("investora", { value: FEE });

      const payload = decodePayload(await ctx.router.lastData());
      expect(payload.owner).to.equal(ctx.investor.address);
      expect(payload.owner).to.not.equal(ctx.stranger.address);
      expect(payload.authorized).to.equal(true);
    });

    it("sends a CCIP message carrying the decision and evidence", async function () {
      const ctx = await loadFixture(deployFixture);
      const node = await registerVerified(ctx, "investora");

      await ctx.beacon.publish("investora", { value: FEE });

      expect(await ctx.router.sendCount()).to.equal(1n);
      expect(await ctx.router.lastDestinationChainSelector()).to.equal(HEDERA_SELECTOR);
      expect(await ctx.router.lastReceiver()).to.equal(ctx.hederaReceiver.address);

      const payload = decodePayload(await ctx.router.lastData());
      expect(payload.node).to.equal(node);
      expect(payload.owner).to.equal(ctx.investor.address);
      expect(payload.authorized).to.equal(true);
      expect(payload.kyc).to.equal("verified");
      expect(payload.jurisdiction).to.equal("US");
      expect(payload.accreditationExpiry).to.equal("2027-03-01");
      expect(payload.lockupUntil).to.equal("");
      expect(payload.lockupUntilTimestamp).to.equal(0n);
      expect(payload.nameExpiry).to.equal(FUTURE_EXPIRY);
      expect(payload.sourceBlock).to.be.greaterThan(0n);
      expect(payload.sourceTimestamp).to.be.greaterThan(0n);
    });

    it("publishes an unauthorized verdict rather than reverting on a blocked investor", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investorb", { kyc: "pending" });

      await ctx.beacon.publish("investorb", { value: FEE });

      const payload = decodePayload(await ctx.router.lastData());
      // Revoking has to be publishable, or a name could never be un-authorized
      // downstream.
      expect(payload.authorized).to.equal(false);
      expect(payload.kyc).to.equal("pending");
    });

    it("publishes a revocation for an expired name, carrying a zero owner", async function () {
      const ctx = await loadFixture(deployFixture);
      const soon = BigInt(await time.latest()) + 120n;
      await registerVerified(ctx, "investorc", { expiry: soon });
      await time.increaseTo(soon + 1n);

      // The most important message the system sends: the one that takes
      // authorization away. Every text field is empty here, so this also
      // covers encoding a payload full of empty dynamic strings.
      await ctx.beacon.publish("investorc", { value: FEE });

      const payload = decodePayload(await ctx.router.lastData());
      expect(payload.authorized).to.equal(false);
      expect(payload.owner).to.equal(hre.ethers.ZeroAddress);
      expect(payload.node).to.equal(nodeFor("investorc"));
      expect(payload.kyc).to.equal("");
      expect(payload.nameExpiry).to.equal(soon);
    });

    it("publishes for a name that was never registered", async function () {
      const ctx = await loadFixture(deployFixture);
      await ctx.beacon.publish("ghost", { value: FEE });

      const payload = decodePayload(await ctx.router.lastData());
      expect(payload.authorized).to.equal(false);
      expect(payload.owner).to.equal(hre.ethers.ZeroAddress);
      expect(payload.nameExpiry).to.equal(0n);
    });

    it("is permissionless — a stranger can publish someone else's name", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");

      await ctx.beacon.connect(ctx.stranger).publish("investora", { value: FEE });
      expect(await ctx.router.sendCount()).to.equal(1n);
    });

    it("emits CompliancePublished with the owner, decision and fee", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");

      await expect(ctx.beacon.publish("investora", { value: FEE }))
        .to.emit(ctx.beacon, "CompliancePublished")
        .withArgs(await ctx.router.nextMessageId(), "investora", ctx.investor.address, true, FEE);
    });

    it("reverts when the fee is underpaid, naming what was required", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");

      await expect(ctx.beacon.publish("investora", { value: FEE - 1n }))
        .to.be.revertedWithCustomError(ctx.beacon, "InsufficientFee")
        .withArgs(FEE, FEE - 1n);
    });

    it("refunds overpayment and keeps no balance", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");

      const overpay = FEE * 3n;
      const before = await hre.ethers.provider.getBalance(ctx.deployer.address);
      const tx = await ctx.beacon.publish("investora", { value: overpay });
      const receipt = await tx.wait();
      const after = await hre.ethers.provider.getBalance(ctx.deployer.address);

      const gasCost = receipt.gasUsed * receipt.gasPrice;
      // Only the fee should have left the caller's balance, not the overpay.
      expect(before - after - gasCost).to.equal(FEE);
      expect(await hre.ethers.provider.getBalance(await ctx.beacon.getAddress())).to.equal(0n);
      expect(await ctx.router.lastValue()).to.equal(FEE);
    });

    it("reverts the whole call when the refund cannot be delivered", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");
      const rejecter = await hre.ethers.deployContract("RefundRejecter");

      await expect(
        rejecter.publish(await ctx.beacon.getAddress(), "investora", { value: FEE * 2n }),
      ).to.be.revertedWith("refund failed");

      expect(await hre.ethers.provider.getBalance(await ctx.beacon.getAddress())).to.equal(0n);
    });
  });

  describe("quote", function () {
    it("returns the router's fee", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");
      expect(await ctx.beacon.quote("investora")).to.equal(FEE);
    });

    it("tracks a fee change, so callers cannot rely on a stale quote", async function () {
      const ctx = await loadFixture(deployFixture);
      await registerVerified(ctx, "investora");
      await ctx.router.setFee(FEE * 2n);
      expect(await ctx.beacon.quote("investora")).to.equal(FEE * 2n);
    });
  });
});
