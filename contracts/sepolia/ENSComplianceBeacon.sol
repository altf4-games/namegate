// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";

/// @dev Subset of ENSv2's `IRegistry` / `IStandardRegistry` that the beacon
///      needs. Transcribed from ensdomains/contracts-v2 @ main:
///      src/registry/interfaces/IRegistry.sol and PermissionedRegistry.sol.
///
///      `getResolver` takes a plain string LABEL, not a namehash and not a
///      uint256. An earlier attempt at `getResolver(uint256)` reverted against
///      the deployed registry, which is what sent us to the source.
interface IEnsRegistry {
    function getResolver(string calldata label) external view returns (address);

    function getExpiry(uint256 anyId) external view returns (uint64);
}

/// @dev ENSIP-5 text resolution. `PermissionedResolver.text` is a plain
///      storage read (`return _record(node).texts[key];`) with no
///      `OffchainLookup` anywhere in the contract, so a Solidity staticcall
///      resolves it. That is the property the whole beacon design rests on:
///      if this needed CCIP-Read, an on-chain reader would be impossible and
///      the architecture would collapse back into a trusted relayer.
interface ITextResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/**
 * @title ENSComplianceBeacon
 * @notice Reads an investor's compliance state from ENSv2 on Sepolia and
 *         ships it to Hedera over Chainlink CCIP.
 *
 * The point of this contract is what it does NOT do. It does not accept a
 * compliance status as an argument, and it has no privileged reporter. It
 * reads `resolver.text(...)` on-chain, in the same transaction that calls
 * `ccipSend`, and `publish` is permissionless — anyone may refresh any name
 * by paying the CCIP fee. There is no relayer to trust with the contents of
 * a record, because nobody is ever asked what the record says.
 *
 * CCIP is trusted for delivery and ordering only, never for content.
 *
 * Expiry is not checked here by parsing a date. ENSv2's registry returns
 * `address(0)` from `getResolver` once a name has expired, so an expired
 * accreditation makes the record structurally unreadable and the beacon
 * reports the investor as unauthorized. Accreditation expiry IS name expiry.
 */
contract ENSComplianceBeacon {
    /// @notice The registry holding investor subnames (the issuer's
    ///         `UserRegistry` for `namegate.eth`).
    IEnsRegistry public immutable registry;

    /// @notice `namehash("namegate.eth")`. Investor nodes are derived from
    ///         this and the label, so a caller cannot point the beacon at an
    ///         arbitrary node under someone else's name.
    bytes32 public immutable parentNode;

    IRouterClient public immutable router;

    /// @notice CCIP destination chain selector (Hedera testnet).
    uint64 public immutable destinationChainSelector;

    /// @notice The `NameGateEnsControlList` on Hedera.
    address public immutable receiver;

    /// @notice Gas allowance for the callback on Hedera.
    uint256 public constant DESTINATION_GAS_LIMIT = 200_000;

    string public constant KEY_KYC = "compliance.kyc";
    string public constant KEY_JURISDICTION = "compliance.jurisdiction";
    string public constant KEY_ACCREDITATION_EXPIRY = "compliance.accreditation-expiry";
    string public constant KEY_LOCKUP_UNTIL = "compliance.lockup-until";

    /// @dev The only value of `compliance.kyc` that counts as passing. Stored
    ///      as a hash so the comparison is a single word compare. Mirrors
    ///      `evaluateEligibility` in ens/src/compliance.ts, which is unit
    ///      tested against the same rule.
    bytes32 private constant KYC_VERIFIED_HASH = keccak256(bytes("verified"));

    struct ComplianceRecord {
        address resolver;
        bytes32 node;
        string kyc;
        string jurisdiction;
        string accreditationExpiry;
        string lockupUntil;
        uint64 nameExpiry;
        bool authorized;
    }

    event CompliancePublished(
        bytes32 indexed messageId,
        string label,
        address indexed investor,
        bool authorized,
        uint256 fee
    );

    error EmptyLabel();
    error ZeroAddress();
    error InsufficientFee(uint256 required, uint256 provided);

    constructor(
        IEnsRegistry _registry,
        bytes32 _parentNode,
        IRouterClient _router,
        uint64 _destinationChainSelector,
        address _receiver
    ) {
        if (
            address(_registry) == address(0) ||
            address(_router) == address(0) ||
            _receiver == address(0)
        ) {
            revert ZeroAddress();
        }
        registry = _registry;
        parentNode = _parentNode;
        router = _router;
        destinationChainSelector = _destinationChainSelector;
        receiver = _receiver;
    }

    /// @notice `namehash(label + "." + parent)`, per ENSIP-1.
    function nodeFor(string calldata label) public view returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }

    /**
     * @notice Reads an investor's live compliance state from ENS. Free, and
     *         callable by anyone — this is the "here's why" answer, readable
     *         without sending a cross-chain message or paying a fee.
     *
     * @dev A zero `resolver` means the name is expired or was never
     *      registered. Both are correctly unauthorized, and both are
     *      reported rather than reverted so a caller can tell them apart by
     *      inspecting `nameExpiry`.
     */
    function readCompliance(string calldata label)
        public
        view
        returns (ComplianceRecord memory record)
    {
        if (bytes(label).length == 0) revert EmptyLabel();

        record.node = nodeFor(label);
        record.resolver = registry.getResolver(label);
        record.nameExpiry = registry.getExpiry(uint256(keccak256(bytes(label))));

        if (record.resolver == address(0)) {
            return record;
        }

        ITextResolver resolver = ITextResolver(record.resolver);
        record.kyc = resolver.text(record.node, KEY_KYC);
        record.jurisdiction = resolver.text(record.node, KEY_JURISDICTION);
        record.accreditationExpiry = resolver.text(record.node, KEY_ACCREDITATION_EXPIRY);
        record.lockupUntil = resolver.text(record.node, KEY_LOCKUP_UNTIL);

        record.authorized = keccak256(bytes(record.kyc)) == KYC_VERIFIED_HASH;
    }

    /// @notice CCIP fee for `publish`, in wei. Quote before sending; the fee
    ///         moves with gas conditions on both chains.
    function quote(string calldata label, address investor)
        public
        view
        returns (uint256 fee)
    {
        ComplianceRecord memory record = readCompliance(label);
        return router.getFee(destinationChainSelector, _buildMessage(record, investor));
    }

    /**
     * @notice Reads `label`'s compliance state from ENS and forwards it to
     *         Hedera. PERMISSIONLESS: any caller, any name. The caller pays
     *         the CCIP fee and any excess is refunded.
     *
     * @param label    Investor label under the parent name, e.g. "investora".
     * @param investor The address the control list will gate on Hedera.
     */
    function publish(string calldata label, address investor)
        external
        payable
        returns (bytes32 messageId)
    {
        if (investor == address(0)) revert ZeroAddress();

        ComplianceRecord memory record = readCompliance(label);
        Client.EVM2AnyMessage memory message = _buildMessage(record, investor);

        uint256 fee = router.getFee(destinationChainSelector, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        messageId = router.ccipSend{value: fee}(destinationChainSelector, message);

        // Refund the overpayment rather than keeping it. The contract holds
        // no balance of its own and has no owner who could withdraw one.
        uint256 excess = msg.value - fee;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            require(ok, "refund failed");
        }

        emit CompliancePublished(messageId, label, investor, record.authorized, fee);
    }

    /// @dev The wire format the Hedera control list decodes. `block.number`
    ///      and `block.timestamp` are the freshness anchor: the receiver can
    ///      reject a message carrying an older source block than one it has
    ///      already applied, which is what stops a stale replay from
    ///      re-authorizing a since-revoked investor.
    ///
    ///      Every field read from ENS is carried, including the two the
    ///      current `authorized` rule does not consider
    ///      (`accreditationExpiry` and `lockupUntil`). Sending the whole
    ///      record now means the Hedera side can start enforcing a rule this
    ///      contract does not yet enforce without a new wire format, and
    ///      without redeploying the beacon.
    function _buildMessage(ComplianceRecord memory record, address investor)
        internal
        view
        returns (Client.EVM2AnyMessage memory)
    {
        bytes memory payload = abi.encode(
            record.node,
            investor,
            record.authorized,
            record.kyc,
            record.jurisdiction,
            record.accreditationExpiry,
            record.lockupUntil,
            record.nameExpiry,
            block.number,
            block.timestamp
        );

        return
            Client.EVM2AnyMessage({
                receiver: abi.encode(receiver),
                data: payload,
                tokenAmounts: new Client.EVMTokenAmount[](0),
                feeToken: address(0), // pay in native ETH
                extraArgs: Client._argsToBytes(
                    Client.EVMExtraArgsV1({gasLimit: DESTINATION_GAS_LIMIT})
                )
            });
    }
}
