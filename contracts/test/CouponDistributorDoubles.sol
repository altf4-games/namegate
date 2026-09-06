// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

// Test doubles, used ONLY by test/contracts/CouponDistributor.test.js on a
// local Hardhat network. Never deployed to a real network.
//
// What they can and cannot prove: they let CouponDistributor's own decision
// logic (authorization gating, double-payment prevention, amount
// computation, insufficient-balance handling, reentrancy-effects-before-
// interaction ordering) be tested in isolation and cheaply. They cannot
// prove the real deployed bond's getCouponAmountFor returns the shape this
// contract expects — that was confirmed empirically against the live
// factory (see hedera/src/abi.ts) and is re-checked by
// hedera/test/live/couponLive.test.ts, not by these doubles.

contract FakeBondCoupons {
    mapping(uint256 => mapping(address => uint256)) private _numerator;
    mapping(uint256 => mapping(address => uint256)) private _denominator;
    mapping(uint256 => mapping(address => bool)) private _recordDateReached;

    function setAmount(
        uint256 couponID,
        address account,
        uint256 numerator,
        uint256 denominator,
        bool recordDateReached
    ) external {
        _numerator[couponID][account] = numerator;
        _denominator[couponID][account] = denominator;
        _recordDateReached[couponID][account] = recordDateReached;
    }

    function getCouponAmountFor(
        uint256 couponID,
        address account
    ) external view returns (uint256 numerator, uint256 denominator, bool recordDateReached) {
        return (
            _numerator[couponID][account],
            _denominator[couponID][account],
            _recordDateReached[couponID][account]
        );
    }
}

contract FakeControlList {
    mapping(address => bool) private _authorized;

    function setAuthorized(address account, bool authorized) external {
        _authorized[account] = authorized;
    }

    function isAuthorized(address account) external view returns (bool) {
        return _authorized[account];
    }
}

/// @dev Rejects incoming ETH, to test that a failed payout reverts the whole
///      distribute() call rather than silently marking it paid anyway.
contract RejectsPayment {
    // Deliberately no receive()/fallback — any plain ETH transfer to this
    // contract reverts.
}

/// @dev Calls distribute() again from within its own receive(), to prove
///      the paid[] flag is set BEFORE the external call (checks-effects-
///      interactions), so a reentrant second call sees AlreadyPaid rather
///      than draining a second payout.
contract ReentrantHolder {
    address public distributor;
    uint256 public couponID;
    bool public reentered;
    bytes public reentryRevertData;

    function arm(address _distributor, uint256 _couponID) external {
        distributor = _distributor;
        couponID = _couponID;
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            (bool ok, bytes memory ret) = distributor.call(
                abi.encodeWithSignature("distribute(uint256,address)", couponID, address(this))
            );
            if (!ok) {
                reentryRevertData = ret;
            }
        }
    }
}
