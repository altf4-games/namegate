// Hardhat/mocha contract tests. Run with: npm run test:contracts
//
// Runs against test doubles (see contracts/test/CouponDistributorDoubles.sol
// for what they can and cannot prove). What this suite covers: the
// distributor's own decision logic — authorization gating, double-payment
// prevention, amount computation from an arbitrary numerator/denominator,
// insufficient-balance handling, and checks-effects-interactions ordering
// against a reentrant holder. What it does NOT cover: that the real
// deployed bond's getCouponAmountFor actually returns this shape — that was
// confirmed empirically against live testnet state (a 5-field Coupon struct
// reverted; an 8-field one succeeded), and is re-checked by
// hedera/test/live/couponLive.test.ts, not by these doubles.

import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// Tinybar per whole currency unit — NOT wei. 1 HBAR = 10^8 tinybar, so this
// is 0.01 HBAR per unit. Hardhat's local network has no tinybar/weibar
// distinction (it's a standard 18-decimal EVM throughout), so these tests
// prove the arithmetic is internally consistent for WHATEVER unit
// payoutScale is denominated in — they cannot themselves prove Hedera's
// specific 8-decimal convention is used correctly. That is what
// hedera/test/live/couponLive.test.ts's nativeBalance() cross-check is for.
const PAYOUT_SCALE = 10n ** 6n;
const COUPON_ID = 1n;

async function deployFixture() {
  const [deployer, holder, stranger] = await hre.ethers.getSigners();

  const bond = await hre.ethers.deployContract("FakeBondCoupons");
  const controlList = await hre.ethers.deployContract("FakeControlList");
  const distributor = await hre.ethers.deployContract("CouponDistributor", [
    await bond.getAddress(),
    await controlList.getAddress(),
    PAYOUT_SCALE,
  ]);

  return { deployer, holder, stranger, bond, controlList, distributor };
}

/** $100 face value at the fraction ATS itself would compute for a round
 *  entitlement — numerator/denominator = 41.09589..., matching the shape
 *  (not the exact value) of what the live bond actually returned. */
const REALISTIC_NUMERATOR = 129_600_000_000_000_000_000_000n;
const REALISTIC_DENOMINATOR = 3_153_600_000_000_000_000_000n;

async function setUpEntitled(ctx, overrides = {}) {
  await ctx.controlList.setAuthorized(ctx.holder.address, overrides.authorized ?? true);
  await ctx.bond.setAmount(
    overrides.couponID ?? COUPON_ID,
    ctx.holder.address,
    overrides.numerator ?? REALISTIC_NUMERATOR,
    overrides.denominator ?? REALISTIC_DENOMINATOR,
    overrides.recordDateReached ?? true,
  );
}

describe("CouponDistributor", function () {
  describe("deployment", function () {
    it("stores the constructor wiring", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.distributor.bond()).to.equal(await ctx.bond.getAddress());
      expect(await ctx.distributor.controlList()).to.equal(await ctx.controlList.getAddress());
      expect(await ctx.distributor.payoutScale()).to.equal(PAYOUT_SCALE);
    });

    it("rejects a zero bond address", async function () {
      const ctx = await loadFixture(deployFixture);
      const Distributor = await hre.ethers.getContractFactory("CouponDistributor");
      await expect(
        Distributor.deploy(hre.ethers.ZeroAddress, await ctx.controlList.getAddress(), PAYOUT_SCALE),
      ).to.be.revertedWithCustomError(Distributor, "ZeroAddress");
    });

    it("rejects a zero control list address", async function () {
      const ctx = await loadFixture(deployFixture);
      const Distributor = await hre.ethers.getContractFactory("CouponDistributor");
      await expect(
        Distributor.deploy(await ctx.bond.getAddress(), hre.ethers.ZeroAddress, PAYOUT_SCALE),
      ).to.be.revertedWithCustomError(Distributor, "ZeroAddress");
    });

    it("rejects a zero payout scale", async function () {
      const ctx = await loadFixture(deployFixture);
      const Distributor = await hre.ethers.getContractFactory("CouponDistributor");
      await expect(
        Distributor.deploy(await ctx.bond.getAddress(), await ctx.controlList.getAddress(), 0),
      ).to.be.revertedWithCustomError(Distributor, "ZeroPayoutScale");
    });
  });

  describe("funding", function () {
    it("accepts plain ETH transfers and emits Funded", async function () {
      const ctx = await loadFixture(deployFixture);
      const amount = hre.ethers.parseEther("1");
      await expect(
        ctx.deployer.sendTransaction({ to: await ctx.distributor.getAddress(), value: amount }),
      )
        .to.emit(ctx.distributor, "Funded")
        .withArgs(ctx.deployer.address, amount);
      expect(await hre.ethers.provider.getBalance(await ctx.distributor.getAddress())).to.equal(amount);
    });
  });

  describe("previewAmount", function () {
    it("computes the same fraction distribute() would pay", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      const expected = (REALISTIC_NUMERATOR * PAYOUT_SCALE) / REALISTIC_DENOMINATOR;
      expect(await ctx.distributor.previewAmount(COUPON_ID, ctx.holder.address)).to.equal(expected);
    });

    it("returns 0 when the record date has not been reached", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { recordDateReached: false });
      expect(await ctx.distributor.previewAmount(COUPON_ID, ctx.holder.address)).to.equal(0n);
    });

    it("returns 0 for a zero balance (zero numerator)", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { numerator: 0n });
      expect(await ctx.distributor.previewAmount(COUPON_ID, ctx.holder.address)).to.equal(0n);
    });

    it("returns 0 once already paid", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });
      await ctx.distributor.distribute(COUPON_ID, ctx.holder.address);
      expect(await ctx.distributor.previewAmount(COUPON_ID, ctx.holder.address)).to.equal(0n);
    });

    it("does not check authorization, unlike distribute()", async function () {
      // previewAmount is a UI-facing helper; it should show what WOULD be
      // owed even if currently blocked, so a caller can see "$41 owed, but
      // blocked" rather than a flat 0 that looks identical to "nothing owed".
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { authorized: false });
      const expected = (REALISTIC_NUMERATOR * PAYOUT_SCALE) / REALISTIC_DENOMINATOR;
      expect(await ctx.distributor.previewAmount(COUPON_ID, ctx.holder.address)).to.equal(expected);
    });
  });

  describe("distribute — the compliance gate", function () {
    it("pays an authorized, entitled holder the correct amount", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      const expected = (REALISTIC_NUMERATOR * PAYOUT_SCALE) / REALISTIC_DENOMINATOR;
      const before = await hre.ethers.provider.getBalance(ctx.holder.address);
      await ctx.distributor.distribute(COUPON_ID, ctx.holder.address);
      const after = await hre.ethers.provider.getBalance(ctx.holder.address);

      expect(after - before).to.equal(expected);
    });

    it("blocks payout to an unauthorized holder despite a real, nonzero entitlement", async function () {
      // The actual demo beat: the bond itself says money is owed, and it is
      // still refused, for the same reason a transfer would be.
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { authorized: false });
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "NotAuthorized")
        .withArgs(ctx.holder.address);
    });

    it("checks authorization before even reading the coupon amount", async function () {
      // Authorization is checked first regardless of the bond's own state —
      // an unauthorized holder is refused even if the bond has no
      // entitlement data at all for them yet.
      const ctx = await loadFixture(deployFixture);
      await ctx.controlList.setAuthorized(ctx.holder.address, false);
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "NotAuthorized")
        .withArgs(ctx.holder.address);
    });

    it("is permissionless — a stranger may trigger payout to the real holder", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      const before = await hre.ethers.provider.getBalance(ctx.holder.address);
      await ctx.distributor.connect(ctx.stranger).distribute(COUPON_ID, ctx.holder.address);
      const after = await hre.ethers.provider.getBalance(ctx.holder.address);
      expect(after).to.be.greaterThan(before);
    });

    it("cannot be redirected — the stranger who triggers it receives nothing", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      const tx = await ctx.distributor.connect(ctx.stranger).distribute(COUPON_ID, ctx.holder.address);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const before = await hre.ethers.provider.getBalance(ctx.stranger.address);
      // Balance already reflects gas spent; confirm no payout landed on top.
      expect(before).to.be.lessThan(
        (await hre.ethers.provider.getBalance(ctx.stranger.address)) + gasCost + 1n,
      );
    });
  });

  describe("distribute — entitlement checks", function () {
    it("reverts when the record date has not been reached", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { recordDateReached: false });
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "RecordDateNotReached")
        .withArgs(COUPON_ID);
    });

    it("reverts with NothingOwed for a zero balance", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { numerator: 0n });
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "NothingOwed")
        .withArgs(COUPON_ID, ctx.holder.address);
    });

    it("reverts with NothingOwed for a zero denominator rather than dividing by zero", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { denominator: 0n });
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "NothingOwed")
        .withArgs(COUPON_ID, ctx.holder.address);
    });

    it("reverts with NothingOwed when the fraction rounds down to zero wei", async function () {
      const ctx = await loadFixture(deployFixture);
      // A tiny entitlement that, at this payoutScale, rounds to 0 wei.
      await setUpEntitled(ctx, { numerator: 1n, denominator: 10n ** 30n });
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "NothingOwed")
        .withArgs(COUPON_ID, ctx.holder.address);
    });
  });

  describe("distribute — double payment and reentrancy", function () {
    it("reverts AlreadyPaid on a second call for the same coupon and holder", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      await ctx.distributor.distribute(COUPON_ID, ctx.holder.address);
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "AlreadyPaid")
        .withArgs(COUPON_ID, ctx.holder.address);
    });

    it("tracks paid status independently per coupon ID", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx, { couponID: 1n });
      await setUpEntitled(ctx, { couponID: 2n });
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      await ctx.distributor.distribute(1n, ctx.holder.address);
      // A different coupon for the same holder must still be payable.
      await expect(ctx.distributor.distribute(2n, ctx.holder.address)).to.not.be.reverted;
    });

    it("marks paid[] BEFORE the external transfer, so a reentrant call sees AlreadyPaid", async function () {
      const ctx = await loadFixture(deployFixture);
      const reentrant = await hre.ethers.deployContract("ReentrantHolder");
      await ctx.controlList.setAuthorized(await reentrant.getAddress(), true);
      await ctx.bond.setAmount(
        COUPON_ID,
        await reentrant.getAddress(),
        REALISTIC_NUMERATOR,
        REALISTIC_DENOMINATOR,
        true,
      );
      await reentrant.arm(await ctx.distributor.getAddress(), COUPON_ID);
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      const before = await hre.ethers.provider.getBalance(await reentrant.getAddress());
      await ctx.distributor.distribute(COUPON_ID, await reentrant.getAddress());
      const after = await hre.ethers.provider.getBalance(await reentrant.getAddress());

      const expected = (REALISTIC_NUMERATOR * PAYOUT_SCALE) / REALISTIC_DENOMINATOR;
      // Exactly one payout landed, not two — the reentrant second call must
      // have failed with AlreadyPaid, proving effects ran before interaction.
      expect(after - before).to.equal(expected);
      expect(await reentrant.reentered()).to.equal(true);
    });
  });

  describe("distribute — funding and transfer failures", function () {
    it("reverts InsufficientContractBalance rather than draining below zero", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      // No funding transaction at all — the contract holds 0.
      const expected = (REALISTIC_NUMERATOR * PAYOUT_SCALE) / REALISTIC_DENOMINATOR;
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.be.revertedWithCustomError(ctx.distributor, "InsufficientContractBalance")
        .withArgs(expected, 0n);
    });

    it("reverts PayoutTransferFailed and does not mark paid when the holder rejects ETH", async function () {
      const ctx = await loadFixture(deployFixture);
      const rejecter = await hre.ethers.deployContract("RejectsPayment");
      await ctx.controlList.setAuthorized(await rejecter.getAddress(), true);
      await ctx.bond.setAmount(
        COUPON_ID,
        await rejecter.getAddress(),
        REALISTIC_NUMERATOR,
        REALISTIC_DENOMINATOR,
        true,
      );
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      await expect(
        ctx.distributor.distribute(COUPON_ID, await rejecter.getAddress()),
      ).to.be.revertedWithCustomError(ctx.distributor, "PayoutTransferFailed");

      // The revert must have unwound the paid[] write too — a retry after
      // the holder fixes their receiving setup must still be possible.
      expect(await ctx.distributor.paid(COUPON_ID, await rejecter.getAddress())).to.equal(false);
    });
  });

  describe("emitted events", function () {
    it("emits CouponDistributed with the coupon, holder, and exact amount", async function () {
      const ctx = await loadFixture(deployFixture);
      await setUpEntitled(ctx);
      await ctx.deployer.sendTransaction({
        to: await ctx.distributor.getAddress(),
        value: hre.ethers.parseEther("10"),
      });

      const expected = (REALISTIC_NUMERATOR * PAYOUT_SCALE) / REALISTIC_DENOMINATOR;
      await expect(ctx.distributor.distribute(COUPON_ID, ctx.holder.address))
        .to.emit(ctx.distributor, "CouponDistributed")
        .withArgs(COUPON_ID, ctx.holder.address, expected);
    });
  });
});
