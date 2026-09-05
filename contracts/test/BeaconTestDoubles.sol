// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";

// Test doubles, used ONLY by test/contracts/ENSComplianceBeacon.test.js on a
// local Hardhat network. They are never deployed to a real network and are
// not part of the system.
//
// What they can and cannot prove:
//   - They CAN prove the beacon's own logic: which conditions produce
//     authorized/unauthorized, that publish reverts on an insufficient fee,
//     that overpayment is refunded, that any caller may publish.
//   - They CANNOT prove the beacon reads real ENS or that the CCIP lane
//     works. Only a live Sepolia deployment does that, which is why
//     ens/scripts/11-beacon-publish.ts exists and is run against real testnets.
//
// Keeping the doubles here, clearly marked, is deliberate: the alternative is
// a test suite that can only run against a live network, which means slow,
// flaky, fee-consuming tests that nobody runs and that cannot exercise
// failure paths (you cannot easily make a real router quote a fee you can't
// pay).

contract FakeTextResolver {
    mapping(bytes32 => mapping(string => string)) private _texts;

    function setText(bytes32 node, string calldata key, string calldata value) external {
        _texts[node][key] = value;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }
}

contract FakeEnsRegistry {
    mapping(string => address) private _resolvers;
    mapping(string => address) private _owners;
    mapping(uint256 => uint64) private _expiries;

    /// @dev Mirrors PermissionedRegistry: an expired name resolves to
    ///      address(0) rather than reverting, and its owner is masked the
    ///      same way. Both behaviours were confirmed against the deployed
    ///      registry (findOwner("investorc") returns zero post-expiry), and
    ///      the owner masking is why revocation has to key by node.
    function setEntry(
        string calldata label,
        address resolver,
        address owner,
        uint64 expiry
    ) external {
        _resolvers[label] = resolver;
        _owners[label] = owner;
        _expiries[uint256(keccak256(bytes(label)))] = expiry;
    }

    function getResolver(string calldata label) external view returns (address) {
        if (_isExpired(label)) return address(0);
        return _resolvers[label];
    }

    function findOwner(string calldata label) external view returns (address) {
        if (_isExpired(label)) return address(0);
        return _owners[label];
    }

    function getExpiry(uint256 anyId) external view returns (uint64) {
        return _expiries[anyId];
    }

    function _isExpired(string calldata label) private view returns (bool) {
        return block.timestamp >= _expiries[uint256(keccak256(bytes(label)))];
    }
}

contract FakeCcipRouter is IRouterClient {
    uint256 public fee;
    bytes32 public nextMessageId = keccak256("message");

    bytes public lastData;
    address public lastReceiver;
    uint64 public lastDestinationChainSelector;
    uint256 public lastValue;
    uint256 public sendCount;

    constructor(uint256 _fee) {
        fee = _fee;
    }

    function setFee(uint256 _fee) external {
        fee = _fee;
    }

    function isChainSupported(uint64) external pure returns (bool) {
        return true;
    }

    function getFee(uint64, Client.EVM2AnyMessage memory) external view returns (uint256) {
        return fee;
    }

    function ccipSend(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message)
        external
        payable
        returns (bytes32)
    {
        require(msg.value >= fee, "router: underpaid");
        lastDestinationChainSelector = destinationChainSelector;
        lastData = message.data;
        lastReceiver = abi.decode(message.receiver, (address));
        lastValue = msg.value;
        sendCount++;
        return nextMessageId;
    }
}

/// @dev Rejects incoming ETH, to test that a failed refund reverts the whole
///      publish rather than silently swallowing the caller's money.
contract RefundRejecter {
    function publish(address beacon, string calldata label)
        external
        payable
        returns (bytes32)
    {
        (bool ok, bytes memory ret) = beacon.call{value: msg.value}(
            abi.encodeWithSignature("publish(string)", label)
        );
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return abi.decode(ret, (bytes32));
    }
}
