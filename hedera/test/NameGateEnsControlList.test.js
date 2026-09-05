// Runs on Hardhat's in-memory local network — no live RPC or testnet HBAR
// needed. Run with: npm test (or npx hardhat test)

import { expect } from "chai";
import hre from "hardhat";

describe("NameGateEnsControlList", () => {
  let controlList;
  let owner, investorA, investorB, other;

  beforeEach(async () => {
    [owner, investorA, investorB, other] = await hre.ethers.getSigners();
    const Factory = await hre.ethers.getContractFactory("NameGateEnsControlList");
    controlList = await Factory.deploy(owner.address);
    await controlList.waitForDeployment();
  });

  describe("deployment", () => {
    it("sets the deployer as owner", async () => {
      expect(await controlList.owner()).to.equal(owner.address);
    });

    it("starts with everyone unauthorized", async () => {
      expect(await controlList.isAuthorized(investorA.address)).to.equal(false);
      expect(await controlList.isAuthorized(owner.address)).to.equal(false);
    });
  });

  describe("isAuthorized — this is what ATS's transfer path actually calls", () => {
    it("reflects setAuthorized(true/false)", async () => {
      await controlList.connect(owner).setAuthorized(investorA.address, true);
      expect(await controlList.isAuthorized(investorA.address)).to.equal(true);
      expect(await controlList.isAuthorized(investorB.address)).to.equal(false);

      await controlList.connect(owner).setAuthorized(investorA.address, false);
      expect(await controlList.isAuthorized(investorA.address)).to.equal(false);
    });

    it("is a plain view call — never reverts on an unknown address", async () => {
      // ATS's isAbleToAccess() ANDs this result in on every transfer; it must
      // never revert for an address it's never seen, or every transfer would
      // brick the first time a new address is checked.
      expect(await controlList.isAuthorized(other.address)).to.equal(false);
    });
  });

  describe("setAuthorized — access control", () => {
    it("emits AuthorizationSet", async () => {
      await expect(controlList.connect(owner).setAuthorized(investorA.address, true))
        .to.emit(controlList, "AuthorizationSet")
        .withArgs(investorA.address, true);
    });

    it("reverts for a non-owner caller", async () => {
      await expect(
        controlList.connect(investorA).setAuthorized(investorB.address, true),
      ).to.be.revertedWithCustomError(controlList, "NotOwner");
    });

    it("does not let a rejected caller change state anyway", async () => {
      await expect(
        controlList.connect(other).setAuthorized(other.address, true),
      ).to.be.reverted;
      expect(await controlList.isAuthorized(other.address)).to.equal(false);
    });
  });

  describe("setAuthorizedBatch", () => {
    it("sets multiple addresses in one call", async () => {
      await controlList
        .connect(owner)
        .setAuthorizedBatch([investorA.address, investorB.address], true);
      expect(await controlList.isAuthorized(investorA.address)).to.equal(true);
      expect(await controlList.isAuthorized(investorB.address)).to.equal(true);
      expect(await controlList.isAuthorized(other.address)).to.equal(false);
    });

    it("emits one AuthorizationSet event per address", async () => {
      const tx = await controlList
        .connect(owner)
        .setAuthorizedBatch([investorA.address, investorB.address], true);
      const receipt = await tx.wait();
      const events = receipt.logs.filter(
        (l) => l.fragment && l.fragment.name === "AuthorizationSet",
      );
      expect(events.length).to.equal(2);
    });

    it("can revoke a batch too", async () => {
      await controlList
        .connect(owner)
        .setAuthorizedBatch([investorA.address, investorB.address], true);
      await controlList
        .connect(owner)
        .setAuthorizedBatch([investorA.address], false);
      expect(await controlList.isAuthorized(investorA.address)).to.equal(false);
      expect(await controlList.isAuthorized(investorB.address)).to.equal(true);
    });

    it("reverts for a non-owner caller", async () => {
      await expect(
        controlList.connect(investorA).setAuthorizedBatch([investorA.address], true),
      ).to.be.revertedWithCustomError(controlList, "NotOwner");
    });
  });

  describe("transferOwnership", () => {
    it("moves owner and emits OwnerChanged", async () => {
      await expect(controlList.connect(owner).transferOwnership(other.address))
        .to.emit(controlList, "OwnerChanged")
        .withArgs(owner.address, other.address);
      expect(await controlList.owner()).to.equal(other.address);
    });

    it("only the new owner can call setAuthorized after transfer", async () => {
      await controlList.connect(owner).transferOwnership(other.address);

      await expect(
        controlList.connect(owner).setAuthorized(investorA.address, true),
      ).to.be.revertedWithCustomError(controlList, "NotOwner");

      await controlList.connect(other).setAuthorized(investorA.address, true);
      expect(await controlList.isAuthorized(investorA.address)).to.equal(true);
    });

    it("reverts for a non-owner caller", async () => {
      await expect(
        controlList.connect(investorA).transferOwnership(investorA.address),
      ).to.be.revertedWithCustomError(controlList, "NotOwner");
    });
  });
});
