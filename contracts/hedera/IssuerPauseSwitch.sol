// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev Matches ATS's real `IExternalPause` interface exactly (confirmed
///      against hashgraph/asset-tokenization-studio's
///      facets/layer_1/externalPause/IExternalPause.sol) — a single view
///      function is the entire contract this needs to implement.
interface IExternalPause {
    function isPaused() external view returns (bool);
}

/**
 * @title IssuerPauseSwitch
 * @notice A minimal `IExternalPause` implementation the issuer can flip,
 *         registered on the bond via `addExternalPause` to demonstrate the
 *         "freezes/pauses" compliance control the Tokenization track names
 *         as an extra-points item — otherwise entirely absent from this
 *         project despite the bond already exposing the extension point.
 *
 * ATS composes external pauses with OR, not AND (confirmed against ATS's
 * real IExternalPauseManagement.sol doc comment: "the token is considered
 * paused ... when any listed external pause contract returns true"). That
 * is the opposite of the external-CONTROL-LIST composition this project
 * already relies on elsewhere (AND — every list must authorize, which is
 * exactly the orphan-list bug this project found and fixed live). Getting
 * that backwards here would mean a paused switch either does nothing or
 * — far worse — silently blocks every account until the confusion is
 * resolved, so this is deliberately a single, independent, additive
 * pause source: registering it can only ever make the bond MORE paused,
 * never less, and removing it returns exactly to whatever the bond's own
 * pause state and every OTHER external pause already say.
 *
 * Not the ENS-governed design this project uses for compliance elsewhere —
 * pausing needs to be checked on every Hedera call, and there is no live
 * cross-chain ENS read available on Hedera without the same CCIP relay the
 * beacon/mirror pair already provides for compliance state, which this
 * intentionally does not extend to avoid a redeploy this late in the
 * build. A real next step would be teaching the beacon to also publish
 * from a dedicated `governance.namegate.eth` name.
 */
contract IssuerPauseSwitch is IExternalPause {
    address public immutable issuer;
    bool private paused;

    event PauseToggled(address indexed operator, bool paused);

    error NotIssuer(address caller);

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer(msg.sender);
        _;
    }

    constructor(address _issuer) {
        issuer = _issuer;
    }

    function setPaused(bool _paused) external onlyIssuer {
        paused = _paused;
        emit PauseToggled(msg.sender, _paused);
    }

    function isPaused() external view returns (bool) {
        return paused;
    }
}
