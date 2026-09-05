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

    /// @dev Returns `address(0)` for a name that is expired OR was never
    ///      registered — the registry masks ownership on expiry exactly as it
    ///      masks the resolver. Verified against the deployed registry:
    ///      findOwner("investorc") returns zero once that name expired.
    function findOwner(string calldata label) external view returns (address);
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
 *
 * The address a verdict applies to is NEVER supplied by the caller. It is
 * read from the registry with `findOwner`, so calling `publish` for a name
 * you do not own cannot authorize you. An earlier version took the address as
 * an argument, which let anyone publish a compliant name's `true` verdict
 * bound to their own address — a complete bypass of the compliance layer.
 *
 * NOTE FOR THE RECEIVER: an expired name has no owner, so a revocation
 * message carries `owner == address(0)`. The Hedera side must therefore key
 * its state by `node` and revoke whichever address that node was last bound
 * to. Keying by the payload's address would make revocation impossible for
 * exactly the names that most need revoking.
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

    /// @notice The only resolver whose records this beacon will believe.
    ///
    /// @dev Defence in depth. The security model already withholds
    ///      ROLE_SET_RESOLVER so an investor cannot repoint their name at a
    ///      resolver they control, but that is a property of how registrations
    ///      happen to be configured. Pinning it here makes the beacon enforce
    ///      it at the point it is relied upon: a name pointing anywhere else
    ///      reads as unauthorized rather than as trusted third-party data.
    address public immutable expectedResolver;

    /// @notice Gas allowance for the callback on Hedera.
    ///
    /// @dev Immutable rather than constant because the right value depends on
    ///      what the receiver does with an 11-field payload containing four
    ///      dynamic strings, and Hedera's gas accounting is not Ethereum's.
    ///      A wrong constant would mean redeploying the beacon and updating
    ///      every reference to its address.
    uint256 public immutable destinationGasLimit;

    string public constant KEY_KYC = "compliance.kyc";
    string public constant KEY_JURISDICTION = "compliance.jurisdiction";
    string public constant KEY_ACCREDITATION_EXPIRY = "compliance.accreditation-expiry";
    string public constant KEY_LOCKUP_UNTIL = "compliance.lockup-until";

    /// @dev The only value of `compliance.kyc` that counts as passing. Stored
    ///      as a hash so the comparison is a single word compare. Mirrors
    ///      `evaluateEligibility` in ens/src/compliance.ts, which is unit
    ///      tested against the same rule.
    bytes32 private constant KYC_VERIFIED_HASH = keccak256(bytes("verified"));

    /// @dev Sentinel for a `compliance.lockup-until` value that is present but
    ///      not a valid date. Parsing fails CLOSED: an unreadable lockup is
    ///      treated as a lockup that never ends, never as no lockup at all.
    ///      A typo in a compliance record must not silently authorize someone.
    uint64 internal constant LOCKUP_UNPARSEABLE = type(uint64).max;

    struct ComplianceRecord {
        address resolver;
        /// @notice The name's holder, read from the registry. Zero when the
        ///         name is expired or unregistered. This, never a caller
        ///         argument, is the address a verdict binds to.
        address owner;
        bytes32 node;
        string kyc;
        string jurisdiction;
        string accreditationExpiry;
        string lockupUntil;
        /// @notice `lockupUntil` parsed to a Unix timestamp. Zero means no
        ///         lockup is set; `type(uint64).max` means it was malformed.
        uint64 lockupUntilTimestamp;
        uint64 nameExpiry;
        bool authorized;
    }

    event CompliancePublished(
        bytes32 indexed messageId,
        string label,
        address indexed owner,
        bool authorized,
        uint256 fee
    );

    error EmptyLabel();
    error ZeroAddress();
    error ZeroGasLimit();
    error InsufficientFee(uint256 required, uint256 provided);

    constructor(
        IEnsRegistry _registry,
        bytes32 _parentNode,
        address _expectedResolver,
        IRouterClient _router,
        uint64 _destinationChainSelector,
        address _receiver,
        uint256 _destinationGasLimit
    ) {
        if (
            address(_registry) == address(0) ||
            address(_router) == address(0) ||
            _receiver == address(0) ||
            _expectedResolver == address(0)
        ) {
            revert ZeroAddress();
        }
        if (_destinationGasLimit == 0) revert ZeroGasLimit();
        registry = _registry;
        parentNode = _parentNode;
        expectedResolver = _expectedResolver;
        router = _router;
        destinationChainSelector = _destinationChainSelector;
        receiver = _receiver;
        destinationGasLimit = _destinationGasLimit;
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
        record.owner = registry.findOwner(label);
        record.nameExpiry = registry.getExpiry(uint256(keccak256(bytes(label))));

        // Covers three cases at once, all correctly unauthorized: the name is
        // expired (registry masks the resolver to zero), the name was never
        // registered (also zero), or it points at a resolver this beacon does
        // not trust. The caller can tell them apart from `resolver` and
        // `nameExpiry`, which are reported either way.
        if (record.resolver != expectedResolver) {
            return record;
        }

        ITextResolver resolver = ITextResolver(record.resolver);
        record.kyc = resolver.text(record.node, KEY_KYC);
        record.jurisdiction = resolver.text(record.node, KEY_JURISDICTION);
        record.accreditationExpiry = resolver.text(record.node, KEY_ACCREDITATION_EXPIRY);
        record.lockupUntil = resolver.text(record.node, KEY_LOCKUP_UNTIL);
        record.lockupUntilTimestamp = parseDate(record.lockupUntil);

        // Expiry and resolver trust are already enforced above: control only
        // reaches here for an unexpired name on the pinned resolver. The
        // owner check is belt-and-braces — a verdict with nobody to bind it
        // to must never be `true`.
        record.authorized =
            record.owner != address(0) &&
            keccak256(bytes(record.kyc)) == KYC_VERIFIED_HASH &&
            block.timestamp >= record.lockupUntilTimestamp;
    }

    /**
     * @notice Parses a `YYYY-MM-DD` date to a Unix timestamp at UTC midnight.
     *         Public so the exact parse can be inspected without guessing.
     *
     * @dev Returns 0 for an empty string, meaning "no date set". Returns
     *      `type(uint64).max` for anything malformed, so a bad value blocks
     *      rather than authorizes — see LOCKUP_UNPARSEABLE.
     *
     *      Rejects calendar-invalid dates such as 2027-02-30, which naive
     *      parsers silently roll over into March. The TypeScript side hit
     *      exactly that bug with Date.parse, so it is tested here too.
     */
    function parseDate(string memory value) public pure returns (uint64) {
        bytes memory b = bytes(value);
        if (b.length == 0) return 0;
        if (b.length != 10) return LOCKUP_UNPARSEABLE;
        if (b[4] != "-" || b[7] != "-") return LOCKUP_UNPARSEABLE;

        (uint256 year, bool okYear) = _digits(b, 0, 4);
        (uint256 month, bool okMonth) = _digits(b, 5, 2);
        (uint256 day, bool okDay) = _digits(b, 8, 2);
        if (!okYear || !okMonth || !okDay) return LOCKUP_UNPARSEABLE;

        // The civil-days algorithm below is only valid for years >= 1970,
        // which is also the earliest timestamp this system could mean.
        if (year < 1970 || year > 9999) return LOCKUP_UNPARSEABLE;
        if (month < 1 || month > 12) return LOCKUP_UNPARSEABLE;
        if (day < 1 || day > _daysInMonth(year, month)) return LOCKUP_UNPARSEABLE;

        return uint64(_daysFromCivil(year, month, day) * 86400);
    }

    /// @dev Reads `count` ASCII digits starting at `offset`. Returns ok=false
    ///      on any non-digit, so "20x7-01-01" is rejected rather than
    ///      partially parsed.
    function _digits(bytes memory b, uint256 offset, uint256 count)
        private
        pure
        returns (uint256 value, bool ok)
    {
        for (uint256 i = 0; i < count; i++) {
            uint8 c = uint8(b[offset + i]);
            if (c < 0x30 || c > 0x39) return (0, false);
            value = value * 10 + (c - 0x30);
        }
        return (value, true);
    }

    function _isLeapYear(uint256 year) private pure returns (bool) {
        return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    }

    function _daysInMonth(uint256 year, uint256 month) private pure returns (uint256) {
        if (month == 2) return _isLeapYear(year) ? 29 : 28;
        if (month == 4 || month == 6 || month == 9 || month == 11) return 30;
        return 31;
    }

    /// @dev Days since 1970-01-01. Howard Hinnant's days_from_civil, reduced
    ///      to unsigned arithmetic because callers are restricted to years
    ///      >= 1970 above.
    function _daysFromCivil(uint256 year, uint256 month, uint256 day)
        private
        pure
        returns (uint256)
    {
        if (month <= 2) {
            year -= 1;
        }
        uint256 era = year / 400;
        uint256 yoe = year - era * 400;
        uint256 mp = month > 2 ? month - 3 : month + 9;
        uint256 doy = (153 * mp + 2) / 5 + day - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    /// @notice CCIP fee for `publish`, in wei. Quote before sending; the fee
    ///         moves with gas conditions on both chains.
    function quote(string calldata label) public view returns (uint256 fee) {
        ComplianceRecord memory record = readCompliance(label);
        return router.getFee(destinationChainSelector, _buildMessage(record));
    }

    /**
     * @notice Reads `label`'s compliance state from ENS and forwards it to
     *         Hedera. PERMISSIONLESS: any caller, any name. The caller pays
     *         the CCIP fee and any excess is refunded.
     *
     * @dev Takes no address. The verdict binds to whoever the registry says
     *     holds the name, so paying the fee for someone else's name only ever
     *     republishes the truth about that name. There is deliberately no way
     *     to say "apply this name's verdict to that address".
     *
     * @param label Investor label under the parent name, e.g. "investora".
     */
    function publish(string calldata label)
        external
        payable
        returns (bytes32 messageId)
    {
        ComplianceRecord memory record = readCompliance(label);
        Client.EVM2AnyMessage memory message = _buildMessage(record);

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

        emit CompliancePublished(messageId, label, record.owner, record.authorized, fee);
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
    function _buildMessage(ComplianceRecord memory record)
        internal
        view
        returns (Client.EVM2AnyMessage memory)
    {
        bytes memory payload = abi.encode(
            record.node,
            record.owner,
            record.authorized,
            record.kyc,
            record.jurisdiction,
            record.accreditationExpiry,
            record.lockupUntil,
            record.lockupUntilTimestamp,
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
                // GenericExtraArgsV2, not the deprecated V1 form. Client.sol
                // warns that allowOutOfOrderExecution's "default varies by
                // chain. On some chains, a particular value is enforced,
                // meaning if the expected value is not set, the message
                // request will revert." Out-of-order execution is safe here
                // precisely because the payload carries block.number and
                // block.timestamp, so the receiver can drop a message older
                // than the last one it applied instead of relying on CCIP to
                // order them.
                extraArgs: Client._argsToBytes(
                    Client.GenericExtraArgsV2({
                        gasLimit: destinationGasLimit,
                        allowOutOfOrderExecution: true
                    })
                )
            });
    }
}
