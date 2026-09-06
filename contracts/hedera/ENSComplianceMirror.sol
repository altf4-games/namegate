// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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
 *         security token on Hedera. Also accepts a k-of-n EIP-712 attestation
 *         of the same verdict as a fallback for when CCIP hasn't delivered
 *         yet (documented latency: minutes; observed in this project: up to
 *         ~20 minutes) — both paths write into the exact same state through
 *         one shared internal function, so `isAuthorized` never has to know
 *         or care which one produced its answer.
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
 * TWO INDEPENDENT GUARDS ON EVERY CCIP MESSAGE, before any state changes:
 *   1. `message.sourceChainSelector` must be Sepolia's CCIP selector.
 *   2. `message.sender` must be the one beacon address this contract trusts.
 * Both come from Chainlink's own router, whose identity is enforced by
 * `CCIPReceiver`'s `onlyRouter` modifier — msg.sender must be the router
 * passed to the constructor. A message failing either check is a forged or
 * misrouted message, not a benign race, so it REVERTS rather than being
 * silently ignored: CCIP marks it FAILED, which is a visible signal that
 * something tried to spoof this contract.
 *
 * ORDERING IS BY WALL-CLOCK TIME, NOT BLOCK NUMBER — deliberately, and this
 * is the one design question that blocked the attestation fallback until it
 * was resolved. CCIP delivery is out of order (the beacon sets
 * `allowOutOfOrderExecution: true`), and once a second, independent update
 * path exists (the attestation below), a Sepolia block number stops being a
 * meaningful axis to compare against at all — Sepolia block numbers and an
 * off-chain signer's attestation share no common counter. Chainlink's own
 * OCR protocol solves the equivalent problem by ordering reports on a
 * monotonically increasing round number it maintains itself, not on any
 * single chain's block height; the closest equivalent available here that
 * both a CCIP message (which carries the Sepolia block's timestamp) and an
 * off-chain attestation (which a signer sets to their own observation time)
 * can agree on is Unix time. A message or attestation for a node is applied
 * only if its timestamp is strictly newer than the last one actually
 * applied for that node — otherwise it is a stale or duplicate update, not
 * an attack, and is dropped without reverting.
 *
 * REVOCATION KEYS BY NODE, NEVER BY THE PAYLOAD'S ADDRESS: an expired name
 * has no owner (ENSv2's registry masks it to the zero address — see
 * ENSComplianceBeacon's header), so a revocation carries `owner ==
 * address(0)`. If this contract deauthorized "the zero address" on such an
 * update, the actual investor would stay authorized forever. Instead it
 * remembers which address each node last authorized (`boundOwner`) and
 * deauthorizes THAT address whenever an update for the node reports
 * `authorized == false`, regardless of what address the update carries.
 *
 * STALENESS DECAYS PASSIVELY: `isAuthorized` compares `block.timestamp` at
 * call time against the timestamp of the update that last authorized the
 * address, from EITHER path. No heartbeat transaction is needed — if
 * nothing re-confirms a record within `maxStaleness`, the address stops
 * being authorized on its own, the next time anything asks.
 *
 * WHY THE ATTESTATION PATH CANNOT PERMANENTLY OVERRIDE CCIP: an attestation
 * is just another timestamped update on the same axis. Once the real CCIP
 * message for a node lands with a timestamp newer than whatever the
 * attestation asserted, it wins, because it is now the more recent
 * observation of the truth. The attestation only ever fills the gap while
 * CCIP is in flight — it can never entrench a stale claim, because staying
 * authorized past `maxStaleness` still requires SOMETHING to keep
 * re-confirming it, from either path.
 */
contract ENSComplianceMirror is CCIPReceiver, IExternalControlList, EIP712 {
    /// @notice Sepolia's CCIP chain selector, AS SEEN FROM HEDERA. Not the
    ///         Hedera selector the beacon uses — the two testnets do not
    ///         share one identifier. Verified live against the deployed
    ///         Hedera router: isChainSupported(16015286601757825753) is true.
    uint64 public immutable sourceChainSelector;

    /// @notice The one address on Sepolia this contract will accept CCIP
    ///         messages from — the deployed ENSComplianceBeacon.
    address public immutable sourceSender;

    /// @notice How long an authorization is trusted after the observation
    ///         that produced it, in seconds — measured from whichever path's
    ///         timestamp, CCIP or attestation. CCIP's own latency already
    ///         eats into this budget for that path, which is the
    ///         conservative direction to be wrong.
    uint256 public immutable maxStaleness;

    /// @notice How stale an attestation's own claimed timestamp may be, and
    ///         how far into the future it may claim to be from, at the
    ///         moment it is submitted. Bounds how long a captured signature
    ///         set stays exploitable: after this window, even a fully valid
    ///         k-of-n signature set is refused, and has to be re-signed.
    uint256 public immutable attestationValidityWindow;

    /// @notice How many of `attestationSigners` must sign for an attestation
    ///         to be accepted.
    uint256 public immutable attestationThreshold;

    address[] private _attestationSigners;

    /// @dev Whether an address is currently in the authorized set. Cleared
    ///      immediately on a revocation, independent of staleness.
    mapping(address => bool) private _authorized;

    /// @dev Timestamp of the update that most recently set
    ///      `_authorized[account] = true`, from either path. Compared
    ///      against `block.timestamp` in `isAuthorized`.
    mapping(address => uint256) private _authorizedAt;

    /// @dev The address each node last authorized, so a revocation (which
    ///      may carry a zero address once the name is expired) still knows
    ///      who to deauthorize.
    mapping(bytes32 => address) public boundOwner;

    /// @dev Timestamp of the last update APPLIED for a node, from either
    ///      path. An update carrying a timestamp no newer than this is stale
    ///      or a duplicate and is dropped without reverting.
    mapping(bytes32 => uint256) public lastAppliedAt;

    // keccak256("ComplianceAttestation(bytes32 node,address owner,bool authorized,string kyc,string jurisdiction,string accreditationExpiry,string lockupUntil,uint64 lockupUntilTimestamp,uint64 nameExpiry,uint256 attestedAt)")
    bytes32 private constant COMPLIANCE_ATTESTATION_TYPEHASH =
        keccak256(
            "ComplianceAttestation(bytes32 node,address owner,bool authorized,string kyc,string jurisdiction,string accreditationExpiry,string lockupUntil,uint64 lockupUntilTimestamp,uint64 nameExpiry,uint256 attestedAt)"
        );

    /// @dev Bundles the attestation fields into one struct. Solidity's stack
    ///      depth limit made the equivalent flat parameter list uncompilable
    ///      ("stack too deep") — passing one struct instead of ten scalars
    ///      is the standard fix, and matches ENSComplianceBeacon's own
    ///      ComplianceRecord pattern for the same shape of data.
    struct ComplianceAttestation {
        bytes32 node;
        address owner;
        bool authorized;
        string kyc;
        string jurisdiction;
        string accreditationExpiry;
        string lockupUntil;
        uint64 lockupUntilTimestamp;
        uint64 nameExpiry;
        uint256 attestedAt;
    }

    event ComplianceApplied(
        bytes32 indexed node,
        address indexed owner,
        bool authorized,
        uint256 appliedAt,
        bool viaAttestation
    );

    event StaleUpdateDropped(bytes32 indexed node, uint256 timestamp, uint256 lastApplied);

    error ZeroAddress();
    error ZeroMaxStaleness();
    error ZeroThreshold();
    error ThresholdExceedsSignerCount(uint256 threshold, uint256 signerCount);
    error DuplicateSigner(address signer);
    error UnauthorizedSourceChain(uint64 got, uint64 expected);
    error UnauthorizedSender(address got, address expected);
    error UnexpectedTokens();
    error AttestationTooOld(uint256 attestedAt, uint256 earliestAllowed);
    error AttestationTooFarInFuture(uint256 attestedAt, uint256 latestAllowed);
    error NotEnoughValidSignatures(uint256 valid, uint256 required);
    error SignaturesNotSortedOrDuplicate();
    error UnknownSigner(address recovered);

    constructor(
        address _router,
        uint64 _sourceChainSelector,
        address _sourceSender,
        uint256 _maxStaleness,
        address[] memory _signers,
        uint256 _threshold,
        uint256 _attestationValidityWindow
    ) CCIPReceiver(_router) EIP712("NameGateENSComplianceMirror", "1") {
        // CCIPReceiver's own constructor already rejects a zero router.
        if (_sourceSender == address(0)) revert ZeroAddress();
        if (_maxStaleness == 0) revert ZeroMaxStaleness();
        if (_threshold == 0) revert ZeroThreshold();
        if (_threshold > _signers.length) {
            revert ThresholdExceedsSignerCount(_threshold, _signers.length);
        }
        for (uint256 i = 0; i < _signers.length; i++) {
            if (_signers[i] == address(0)) revert ZeroAddress();
            for (uint256 j = i + 1; j < _signers.length; j++) {
                if (_signers[i] == _signers[j]) revert DuplicateSigner(_signers[i]);
            }
        }

        sourceChainSelector = _sourceChainSelector;
        sourceSender = _sourceSender;
        maxStaleness = _maxStaleness;
        attestationThreshold = _threshold;
        attestationValidityWindow = _attestationValidityWindow;
        _attestationSigners = _signers;
    }

    function attestationSigners() external view returns (address[] memory) {
        return _attestationSigners;
    }

    /// @notice ATS calls this on every transfer authorization check.
    ///
    /// @dev Guards against `_authorizedAt[account]` being ahead of
    ///      `block.timestamp` before subtracting — a plain subtraction would
    ///      underflow and REVERT in that case, which would brick every
    ///      transfer check on the bond that touches this address, not just
    ///      return a wrong answer. This can only happen from an honest
    ///      source: the beacon always sends the real Sepolia block's
    ///      timestamp, and by the time CCIP delivers it minutes later,
    ///      Hedera's clock has moved past it — but a `view` function this
    ///      central should never revert on a timestamp it merely finds
    ///      surprising. A timestamp not yet "reached" by this chain's own
    ///      clock is treated as fresh rather than rejected.
    function isAuthorized(address account) external view override returns (bool) {
        if (!_authorized[account]) return false;
        uint256 authorizedAt = _authorizedAt[account];
        if (authorizedAt >= block.timestamp) return true;
        return block.timestamp - authorizedAt <= maxStaleness;
    }

    /// @notice Seconds since `account` was last confirmed authorized, or
    ///         `type(uint256).max` if it never has been. Never underflows,
    ///         for the same reason `isAuthorized` guards against it above.
    function staleness(address account) external view returns (uint256) {
        if (!_authorized[account]) return type(uint256).max;
        uint256 authorizedAt = _authorizedAt[account];
        if (authorizedAt >= block.timestamp) return 0;
        return block.timestamp - authorizedAt;
    }

    /// @notice The EIP-712 struct hash a signer signs for a given verdict.
    ///         Exposed so an off-chain signer can compute exactly what they
    ///         are being asked to sign, rather than trusting a UI to build
    ///         it correctly.
    function hashComplianceAttestation(ComplianceAttestation calldata a) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                COMPLIANCE_ATTESTATION_TYPEHASH,
                a.node,
                a.owner,
                a.authorized,
                keccak256(bytes(a.kyc)),
                keccak256(bytes(a.jurisdiction)),
                keccak256(bytes(a.accreditationExpiry)),
                keccak256(bytes(a.lockupUntil)),
                a.lockupUntilTimestamp,
                a.nameExpiry,
                a.attestedAt
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Applies a compliance verdict attested by at least
     *         `attestationThreshold` of `attestationSigners`, for use while
     *         a CCIP message for the same update is still in flight.
     *
     * @dev `signatures` must be sorted by the recovered signer's address,
     *      strictly increasing, with no duplicates — the standard pattern
     *      for cheaply proving a set of DISTINCT authorized signers on-chain
     *      without a bitmap or a loop-with-seen-mapping. A signature from
     *      any address other than a configured signer is rejected outright;
     *      it does not silently fail to count.
     *
     *      This is deliberately NOT restricted to any caller — anyone
     *      holding a valid k-of-n signature set may submit it, the same
     *      permissionless shape as the beacon's own `publish`. The security
     *      is entirely in the signatures, not in who broadcasts them.
     */
    function submitAttestation(
        ComplianceAttestation calldata a,
        bytes[] calldata signatures
    ) external {
        if (a.attestedAt + attestationValidityWindow < block.timestamp) {
            revert AttestationTooOld(a.attestedAt, block.timestamp - attestationValidityWindow);
        }
        if (a.attestedAt > block.timestamp + attestationValidityWindow) {
            revert AttestationTooFarInFuture(a.attestedAt, block.timestamp + attestationValidityWindow);
        }
        if (a.authorized && a.owner == address(0)) revert ZeroAddress();

        bytes32 digest = hashComplianceAttestation(a);

        uint256 validCount = 0;
        address previousSigner = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address recovered = ECDSA.recover(digest, signatures[i]);
            if (recovered <= previousSigner) revert SignaturesNotSortedOrDuplicate();
            previousSigner = recovered;
            if (!_isConfiguredSigner(recovered)) revert UnknownSigner(recovered);
            validCount++;
        }
        if (validCount < attestationThreshold) {
            revert NotEnoughValidSignatures(validCount, attestationThreshold);
        }

        _applyUpdate(a.node, a.owner, a.authorized, a.attestedAt, true);
    }

    function _isConfiguredSigner(address account) private view returns (bool) {
        uint256 length = _attestationSigners.length;
        for (uint256 i = 0; i < length; i++) {
            if (_attestationSigners[i] == account) return true;
        }
        return false;
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
            ,
            uint256 sourceTimestamp
        ) = abi.decode(
            message.data,
            (bytes32, address, bool, string, string, string, string, uint64, uint64, uint256, uint256)
        );

        if (authorized && owner == address(0)) revert ZeroAddress();

        _applyUpdate(node, owner, authorized, sourceTimestamp, false);
    }

    /// @dev The one place either path writes state. `timestamp` is Unix
    ///      seconds on the axis described in the contract's header — a
    ///      Sepolia block's own timestamp for CCIP, an attester-claimed
    ///      observation time for an attestation. Ordering, revocation, and
    ///      staleness all behave identically regardless of which path calls
    ///      this, by construction.
    function _applyUpdate(
        bytes32 node,
        address owner,
        bool authorized,
        uint256 timestamp,
        bool viaAttestation
    ) private {
        if (timestamp <= lastAppliedAt[node]) {
            emit StaleUpdateDropped(node, timestamp, lastAppliedAt[node]);
            return;
        }
        lastAppliedAt[node] = timestamp;

        address previousOwner = boundOwner[node];

        if (authorized) {
            // A node changing hands: deauthorize whoever held it before,
            // never leaving a stale authorization behind for an address that
            // no longer owns the name.
            if (previousOwner != address(0) && previousOwner != owner) {
                _authorized[previousOwner] = false;
            }
            boundOwner[node] = owner;
            _authorized[owner] = true;
            _authorizedAt[owner] = timestamp;
        } else {
            // Revoke by node, not by the update's address — an expired name
            // carries owner == address(0) here, and boundOwner[node] is the
            // only place that still knows who to deauthorize.
            if (previousOwner != address(0)) {
                _authorized[previousOwner] = false;
            }
            boundOwner[node] = owner;
        }

        emit ComplianceApplied(node, owner, authorized, timestamp, viaAttestation);
    }
}
