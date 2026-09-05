// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev Matches ATS's own interface exactly — see
/// packages/ats/contracts/contracts/facets/layer_1/externalControlList/IExternalControlList.sol
/// (hashgraph/asset-tokenization-studio @ v.8.0.0-ats). NameGate does not
/// redefine this interface; it implements it, so any ATS security token can
/// register this contract via `addExternalControlList(address)` with no
/// changes to ATS itself.
interface IExternalControlList {
    function isAuthorized(address account) external view returns (bool);
}

/**
 * @title NameGateEnsControlList
 * @notice Backs an ATS security token's transfer authorization with
 *         compliance state mirrored from ENSv2 Sepolia — see
 *         docs/ARCHITECTURE.md, Layer 3.
 *
 * Current scope: a plain owner-writable mapping, so the ENS<->Hedera
 * plumbing and the ATS integration can each be proven independently before
 * they're wired together.
 *
 * Not yet implemented here: `setAuthorized` will be replaced
 * by `_ccipReceive`, restricted to messages from the Sepolia beacon over a
 * verified CCIP route, carrying a monotonic source block and a
 * `maxStaleness` expiry — see docs/ARCHITECTURE.md, "Layer 2 — the beacon"
 * and "Layer 3 — Hedera (ATS)". Swapping the write path does not change
 * this contract's read interface, so it stays a drop-in `IExternalControlList`
 * either way — the bond never needs to be redeployed or re-registered.
 */
contract NameGateEnsControlList is IExternalControlList {
    address public owner;
    mapping(address => bool) private _authorized;

    event AuthorizationSet(address indexed account, bool authorized);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        emit OwnerChanged(address(0), _owner);
    }

    /// @notice ATS calls this on every transfer authorization check.
    function isAuthorized(address account) external view override returns (bool) {
        return _authorized[account];
    }

    /// @notice Stand-in for the CCIP mirror. Sets one account's compliance
    ///         status directly, for testing the ATS integration before the
    ///         cross-chain path is wired up.
    function setAuthorized(address account, bool authorized) external onlyOwner {
        _authorized[account] = authorized;
        emit AuthorizationSet(account, authorized);
    }

    function setAuthorizedBatch(address[] calldata accounts, bool authorized) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _authorized[accounts[i]] = authorized;
            emit AuthorizationSet(accounts[i], authorized);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        // Without this check, transferring to address(0) would permanently
        // brick the contract — no address could ever satisfy onlyOwner
        // again, including to call transferOwnership itself to recover.
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }
}
