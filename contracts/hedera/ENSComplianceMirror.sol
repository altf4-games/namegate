// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";

/// @dev Matches ATS's own interface exactly — see
/// packages/ats/contracts/contracts/facets/layer_1/externalControlList/IExternalControlList.sol
/// (hashgraph/asset-tokenization-studio @ v.8.0.0-ats).
interface IExternalControlList {
    function isAuthorized(address account) external view returns (bool);
}

/**
 * @title ENSComplianceMirror
 * @notice Receives compliance verdicts from `ENSComplianceBeacon` on Sepolia
 *         over Chainlink CCIP and answers `isAuthorized(address)` for an ATS
 *         security token on Hedera.
 *
 * WHY A SEPARATE CONTRACT FROM THE OLD CONTROL LIST: ATS combines multiple
 * registered external control lists with AND — see
 * ExternalControlListManagementStorageWrapper.sol:
 * `if (!IExternalControlList(list).isAuthorized(account)) return false;`
 * for every list. Registering this ALONGSIDE the old owner-writable
 * `NameGateEnsControlList` would require BOTH to say true, doubling
 * maintenance for no security benefit. This REPLACES it: the bond calls
 * `removeExternalControlList` on the old address and `addExternalControlList`
 * on this one. The bond itself is never redeployed.
 *
 * TWO INDEPENDENT GUARDS ON EVERY MESSAGE, before any state changes:
 *   1. `message.sourceChainSelector` must be Sepolia's CCIP selector.
 *   2. `message.sender` must be the one beacon address this contract trusts.
 * Both come from Chainlink's own router, whose identity is enforced by
 * `CCIPReceiver`'s `onlyRouter` modifier — msg.sender must be the router
 * passed to the constructor. A message failing either check is a forged or
 * misrouted message, not a benign race, so it REVERTS rather than being
 * silently ignored: CCIP marks it FAILED, which is a visible signal that
 * something tried to spoof this contract.
 *
 * MONOTONIC ORDERING PER NAME: the beacon sets `allowOutOfOrderExecution:
 * true` (see ENSComplianceBeacon._buildMessage), so CCIP does not guarantee
 * messages arrive in the order they were sent. A message carrying a
 * `sourceBlock` no newer than the last one already applied for that node is
 * a stale or replayed message, not an attack — it is accepted by CCIP
 * (so the message shows delivered, not failed) but produces no state change.
 *
 * REVOCATION KEYS BY NODE, NEVER BY THE PAYLOAD'S ADDRESS: an expired name
 * has no owner (ENSv2's registry masks it to the zero address — see
 * ENSComplianceBeacon's header), so a revocation message carries
 * `owner == address(0)`. If this contract deauthorized "the zero address" on
 * such a message, the actual investor would stay authorized forever. Instead
 * it remembers which address each node last authorized (`boundOwner`) and
 * deauthorizes THAT address whenever a message for the node reports
 * `authorized == false`, regardless of what address the message carries.
 *
 * STALENESS DECAYS PASSIVELY: `isAuthorized` compares `block.timestamp` at
 * call time against the source timestamp of the last message that
 * authorized the address. No heartbeat transaction is needed — if nobody
 * calls `publish()` again within `maxStaleness`, the address stops being
 * authorized on its own, the next time anything asks. This bounds how long
 * a Hedera-side belief can outlive whatever caused it on Sepolia, in the
 * case where a revocation was needed but nobody happened to call publish.
 */
contract ENSComplianceMirror is CCIPReceiver, IExternalControlList {
    /// @notice Sepolia's CCIP chain selector, AS SEEN FROM HEDERA. Not the
    ///         Hedera selector the beacon uses — the two testnets do not
    ///         share one identifier. Verified live against the deployed
    ///         Hedera router: isChainSupported(16015286601757825753) is true.
    uint64 public immutable sourceChainSelector;

    /// @notice The one address on Sepolia this contract will accept messages
    ///         from — the deployed ENSComplianceBeacon.
    address public immutable sourceSender;

    /// @notice How long an authorization is trusted after the ENS read that
    ///         produced it, in seconds. Measured from the message's SOURCE
    ///         timestamp (when the beacon read the record on Sepolia), not
    ///         from delivery time — CCIP's own latency already eats into
    ///         this budget, which is the conservative direction to be wrong.
    uint256 public immutable maxStaleness;

    /// @dev Whether an address is currently in the authorized set. Cleared
    ///      immediately on a revocation message, independent of staleness.
    mapping(address => bool) private _authorized;

    /// @dev Source timestamp of the message that most recently set
    ///      `_authorized[account] = true`. Compared against `block.timestamp`
    ///      in `isAuthorized`.
    mapping(address => uint256) private _authorizedAt;

    /// @dev The address each node last authorized, so a revocation (which
    ///      may carry a zero address once the name is expired) still knows
    ///      who to deauthorize.
    mapping(bytes32 => address) public boundOwner;

    /// @dev Source block of the last message applied for a node. Messages
    ///      carrying an equal or older source block are stale or replayed
    ///      and are dropped without reverting.
    mapping(bytes32 => uint256) public lastAppliedSourceBlock;

    event ComplianceApplied(
        bytes32 indexed node,
        address indexed owner,
        bool authorized,
        uint256 sourceBlock,
        uint256 sourceTimestamp
    );

    event StaleMessageDropped(bytes32 indexed node, uint256 sourceBlock, uint256 lastApplied);

    error ZeroAddress();
    error ZeroMaxStaleness();
    error UnauthorizedSourceChain(uint64 got, uint64 expected);
    error UnauthorizedSender(address got, address expected);
    error UnexpectedTokens();

    constructor(
        address _router,
        uint64 _sourceChainSelector,
        address _sourceSender,
        uint256 _maxStaleness
    ) CCIPReceiver(_router) {
        // CCIPReceiver's own constructor already rejects a zero router.
        if (_sourceSender == address(0)) revert ZeroAddress();
        if (_maxStaleness == 0) revert ZeroMaxStaleness();
        sourceChainSelector = _sourceChainSelector;
        sourceSender = _sourceSender;
        maxStaleness = _maxStaleness;
    }

    /// @notice ATS calls this on every transfer authorization check.
    function isAuthorized(address account) external view override returns (bool) {
        return _authorized[account] && block.timestamp - _authorizedAt[account] <= maxStaleness;
    }

    /// @notice Seconds since `account` was last confirmed authorized, or
    ///         `type(uint256).max` if it never has been. Lets a caller see
    ///         how close an address is to going stale without waiting for
    ///         `isAuthorized` to flip.
    function staleness(address account) external view returns (uint256) {
        if (!_authorized[account]) return type(uint256).max;
        return block.timestamp - _authorizedAt[account];
    }

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        if (message.sourceChainSelector != sourceChainSelector) {
            revert UnauthorizedSourceChain(message.sourceChainSelector, sourceChainSelector);
        }

        address sender = abi.decode(message.sender, (address));
        if (sender != sourceSender) {
            revert UnauthorizedSender(sender, sourceSender);
        }

        // The beacon never attaches tokens. A message that carries any is not
        // something this contract has logic for, and accepting it silently
        // would leave tokens stuck here with no withdrawal path.
        if (message.destTokenAmounts.length != 0) {
            revert UnexpectedTokens();
        }

        (
            bytes32 node,
            address owner,
            bool authorized,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 sourceBlock,
            uint256 sourceTimestamp
        ) = abi.decode(
            message.data,
            (bytes32, address, bool, string, string, string, string, uint64, uint64, uint256, uint256)
        );

        if (sourceBlock <= lastAppliedSourceBlock[node]) {
            emit StaleMessageDropped(node, sourceBlock, lastAppliedSourceBlock[node]);
            return;
        }
        lastAppliedSourceBlock[node] = sourceBlock;

        address previousOwner = boundOwner[node];

        if (authorized) {
            // Guaranteed by the beacon (authorized implies a non-zero owner —
            // see ENSComplianceBeacon.readCompliance), checked here anyway
            // because this contract must never authorize the zero address.
            if (owner == address(0)) revert ZeroAddress();

            // A node changing hands: deauthorize whoever held it before,
            // never leaving a stale authorization behind for an address that
            // no longer owns the name.
            if (previousOwner != address(0) && previousOwner != owner) {
                _authorized[previousOwner] = false;
            }
            boundOwner[node] = owner;
            _authorized[owner] = true;
            _authorizedAt[owner] = sourceTimestamp;
        } else {
            // Revoke by node, not by the payload's address — an expired name
            // carries owner == address(0) here, and boundOwner[node] is the
            // only place that still knows who to deauthorize.
            if (previousOwner != address(0)) {
                _authorized[previousOwner] = false;
            }
            boundOwner[node] = owner;
        }

        emit ComplianceApplied(node, owner, authorized, sourceBlock, sourceTimestamp);
    }
}
