// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev The exact fraction ATS's own bond returns from getCouponAmountFor —
///      confirmed live against the deployed factory (v3.1.0-ats's docs
///      describe a 5-field Coupon struct; the real deployed contract only
///      accepted v4.1.0-ats's 8-field shape, verified by simulateContract
///      succeeding against it — see hedera/src/abi.ts's header comment for
///      the full account of that mismatch). Only this return shape matters
///      here; the input struct that produced it is the bond's own concern.
interface IBondCoupons {
    function getCouponAmountFor(
        uint256 couponID,
        address account
    ) external view returns (uint256 numerator, uint256 denominator, bool recordDateReached);
}

interface IExternalControlList {
    function isAuthorized(address account) external view returns (bool);
}

/**
 * @title CouponDistributor
 * @notice Pays out a bond coupon in native HBAR, gated by the exact same
 *         compliance check the bond's own transfer path uses.
 *
 * ATS's bond has no payout facet at all — `setCoupon`, `getCouponFor`, and
 * `getCouponAmountFor` are declaration plus entitlement calculation, not
 * settlement (confirmed by reading the real interface; there is no
 * claimCoupon, payCoupon, or distributeCoupon anywhere in the source). This
 * contract is the ~60-line settlement layer ATS itself doesn't provide,
 * reading the bond's own real entitlement calculation and gating it on
 * `isAuthorized` — the same control list the bond checks for transfers, so
 * an investor blocked from moving the bond is blocked from its coupon too.
 *
 * `distribute` is permissionless, like the beacon's `publish` and the
 * mirror's `submitAttestation`: it always pays the real holder the bond
 * itself says is owed money, so there is no address for a caller to
 * misdirect funds toward. It is not restricted to any operator.
 *
 * ⚠️ HBAR IS 8 DECIMALS INSIDE THE EVM, NOT 18 — found live, the hard way.
 * `address(this).balance`, `.call{value: x}`, and `payoutScale` here all
 * operate in HBAR's NATIVE tinybar representation (1 HBAR = 10^8 tinybar),
 * confirmed against Hedera's own docs ("Within the EVM environment, HBAR
 * maintains 8 decimal places, consistent with its native representation" —
 * docs.hedera.com, Decimal Handling (8 vs. 18 Decimals)). This is DIFFERENT
 * from what `eth_getBalance` and viem's `getBalance`/`sendTransaction`
 * report externally through the Hashio JSON-RPC relay, which scale to
 * 18-decimal "weibar" for Ethereum-tooling compatibility — 1 tinybar =
 * 10^10 weibar. An earlier version of this contract computed `payoutScale`
 * assuming 18-decimal wei and compared it directly against
 * `address(this).balance`, which is 10 decimal places smaller: a live
 * `distribute()` call reverted with `InsufficientContractBalance` showing
 * `required` and `available` off by roughly 10^10, against a contract that
 * had genuinely just been funded with the intended amount. `nativeBalance()`
 * below exists specifically so a live test can assert this gap against
 * `getBalance` and catch a regression before it silently miscalculates a
 * real payout again — a local Hardhat network cannot reproduce this, since
 * its own EVM has no tinybar/weibar distinction to get wrong.
 *
 * `payoutScale` is tinybar paid per whole unit of the bond's declared
 * currency — e.g. 1_000_000 tinybar (0.01 HBAR) per $1 of coupon
 * entitlement. This is the one intentional simplification here: there is
 * no oracle for what "$1 of declared currency" is worth in real HBAR, so
 * the conversion is a fixed rate set once at construction. Every other
 * number (the balance, the rate, the period, the compliance check, the
 * actual HBAR transferred) comes from real on-chain state and a real
 * transfer, in HBAR's own native unit.
 */
contract CouponDistributor {
    IBondCoupons public immutable bond;
    IExternalControlList public immutable controlList;

    /// @notice Tinybar paid per whole unit of the bond's declared currency.
    ///         NOT wei — see the contract's header. 1 HBAR = 10^8 tinybar.
    uint256 public immutable payoutScale;

    /// @dev Prevents paying the same holder for the same coupon twice.
    mapping(uint256 => mapping(address => bool)) public paid;

    event CouponDistributed(uint256 indexed couponID, address indexed holder, uint256 amountTinybar);
    event Funded(address indexed from, uint256 amountTinybar);

    error ZeroAddress();
    error ZeroPayoutScale();
    error NotAuthorized(address holder);
    error RecordDateNotReached(uint256 couponID);
    error AlreadyPaid(uint256 couponID, address holder);
    error NothingOwed(uint256 couponID, address holder);
    error InsufficientContractBalance(uint256 required, uint256 available);
    error PayoutTransferFailed(address holder, uint256 amount);

    constructor(address _bond, address _controlList, uint256 _payoutScale) {
        if (_bond == address(0) || _controlList == address(0)) revert ZeroAddress();
        if (_payoutScale == 0) revert ZeroPayoutScale();
        bond = IBondCoupons(_bond);
        controlList = IExternalControlList(_controlList);
        payoutScale = _payoutScale;
    }

    /// @notice Accepts funding deposits from anyone — the issuer, in
    ///         practice, but never checked, since holding funds here confers
    ///         no privilege over how they're paid out.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice This contract's own balance, read from inside its own
    ///         execution — i.e. in HBAR's native 8-decimal tinybar
    ///         representation. Exists so a caller (or a live test) can
    ///         compare it directly against `getBalance` over JSON-RPC,
    ///         which reports the same balance scaled to 18-decimal weibar —
    ///         the two will differ by exactly a factor of 10^10, and that
    ///         gap is the whole reason `payoutScale` is denominated the way
    ///         it is.
    function nativeBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice The amount `distribute` would pay `holder` for `couponID`
    ///         right now, in tinybar (NOT wei — see the contract's header) —
    ///         0 if the record date hasn't been reached, if nothing is
    ///         owed, or if already paid. Does not check authorization or
    ///         available balance.
    function previewAmount(uint256 couponID, address holder) public view returns (uint256) {
        if (paid[couponID][holder]) return 0;
        (uint256 numerator, uint256 denominator, bool recordDateReached) = bond.getCouponAmountFor(
            couponID,
            holder
        );
        if (!recordDateReached || denominator == 0 || numerator == 0) return 0;
        return (numerator * payoutScale) / denominator;
    }

    /**
     * @notice Pays `holder` their entitlement for `couponID`, computed live
     *         from the bond's own state, gated by the same control list the
     *         bond checks for transfers. Permissionless — anyone may trigger
     *         a payout for any holder; it can never be misdirected, since
     *         the recipient is always `holder` and the amount is always
     *         what the bond itself says is owed.
     * @return amountTinybar The amount actually paid, in tinybar.
     */
    function distribute(uint256 couponID, address holder) external returns (uint256 amountTinybar) {
        if (paid[couponID][holder]) revert AlreadyPaid(couponID, holder);
        if (!controlList.isAuthorized(holder)) revert NotAuthorized(holder);

        (uint256 numerator, uint256 denominator, bool recordDateReached) = bond.getCouponAmountFor(
            couponID,
            holder
        );
        if (!recordDateReached) revert RecordDateNotReached(couponID);
        if (denominator == 0 || numerator == 0) revert NothingOwed(couponID, holder);

        amountTinybar = (numerator * payoutScale) / denominator;
        if (amountTinybar == 0) revert NothingOwed(couponID, holder);

        if (address(this).balance < amountTinybar) {
            revert InsufficientContractBalance(amountTinybar, address(this).balance);
        }

        // Effects before interaction: marked paid before the external call,
        // so a reentrant call from a malicious holder sees AlreadyPaid.
        paid[couponID][holder] = true;

        (bool ok, ) = holder.call{value: amountTinybar}("");
        if (!ok) revert PayoutTransferFailed(holder, amountTinybar);

        emit CouponDistributed(couponID, holder, amountTinybar);
    }
}
