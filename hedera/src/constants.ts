// Hedera testnet — Asset Tokenization Studio.
//
// Addresses from ATS docs/deployed-addresses.md (documents Smart Contract
// Version 4.0.0, deployed 2026-01-22) — research-notes/task-d-hedera-ats.md
// [d10].
//
// CONFIRMED 2026-09-05 by an actual deployBond call against this factory:
// the deployed contract's ABI does NOT match v8.0.0-ats's IFactory.sol (a
// deployBond built from that source reverts with no return data — a
// selector mismatch, not a business-logic rejection). The struct/role
// values below are transcribed from v3.1.0-ats instead (tagged 2026-01-21,
// one day before this factory's documented deploy date — the closest
// available source to what's actually live). This is the deployment this
// project targets; there is no exact "4.0.0" git tag to confirm against
// byte-for-byte, so treat this as the best available match, not a proven
// exact one. If a deployBond call ever reverts again with empty return
// data, re-diff against v4.1.0-ats (2026-02-03) before assuming anything
// else is wrong.

export const HEDERA_CHAIN_ID = 296;

export const ATS_TESTNET = {
  proxyAdmin: "0x76220dAa89df1d0be4C6997Dc401FCB98A586F6a",
  blrImplementation: "0xd53A586C1b11a5E7c34912a466e97c02Ad2d5786",
  blrProxy: "0xEFEF4CAe9642631Cfc6d997D6207Ee48fa78fe42",
  factoryImplementation: "0x3803219f13E23998FdDCa67AdA60EeB8E62eEEA8",
  factoryProxy: "0x5fA65CA30d1984701F10476664327f97c864A9D3",
} as const;

// BOND_CONFIG_ID is unconfirmed at this version — v3.1.0-ats's IFactory.sol
// doesn't expose a resolver-key constant the way v8.0.0's domain/constants.ts
// does. Kept at the same value used successfully to resolve the bond
// resolver key in the v8.0.0-shaped attempt; re-verify if deployBond starts
// reverting on an unrecognized resolverProxyConfiguration.key instead of
// with empty return data.
export const BOND_CONFIG_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000002" as const;

// Role hashes from hashgraph/asset-tokenization-studio @ v3.1.0-ats,
// packages/ats/contracts/contracts/factory/ERC3643/interfaces/roles.sol —
// these are keccak256("security.token.standard.role.*") and are DIFFERENT
// from v8.0.0-ats's atsRoles.generated.ts values. Using the wrong set is a
// second, independent way for deployBond to revert even after the
// SecurityData field order is fixed.
//
// CONFIRMED BUG, found 2026-09-06: this object used to have only one
// "control list" role, misleadingly named ROLE_CONTROL_LIST_MANAGER but
// actually holding _CONTROL_LIST_ROLE's value. v3.1.0-ats's own
// layer_1/constants/roles.sol defines these as two DIFFERENT roles:
//   _CONTROL_LIST_ROLE           = 0xca537e1c...cac3
//   _CONTROL_LIST_MANAGER_ROLE   = 0x0e625647...72e75
// The first gates ATS's own internal blacklist (ControlListFacet) — a
// feature this project doesn't use (bondData.isWhiteList is false). The
// second is what actually gates addExternalControlList /
// removeExternalControlList, which is the one this project depends on.
// The bug went undetected from the first bond deploy until the day this
// project first called addExternalControlList as a standalone transaction —
// every earlier "verification" only checked hasRole() against the WRONG
// role, which trivially returned true because that's the role that was
// actually granted. The bond deployed before this fix landed needed
// grantRole(ROLE_CONTROL_LIST_MANAGER, issuer) run once, live, to correct it
// without a full redeploy.
export const ATS_ROLES = {
  DEFAULT_ADMIN_ROLE:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  // Gates ATS's own internal blacklist feature (ControlListFacet). Not used
  // by this project's compliance design, but real and distinct from the role
  // below — kept named accurately rather than removed, so nobody re-derives
  // this confusion from scratch.
  ROLE_CONTROL_LIST:
    "0xca537e1c88c9f52dc5692c96c482841c3bea25aafc5f3bfe96f645b5f800cac3",
  // Gates addExternalControlList / removeExternalControlList — the role
  // this project actually needs to swap in ENSComplianceMirror.
  ROLE_CONTROL_LIST_MANAGER:
    "0x0e625647b832ec7d4146c12550c31c065b71e0a698095568fd8320dd2aa72e75",
  ROLE_CORPORATE_ACTION:
    "0x8a139eeb747b9809192ae3de1b88acfd2568c15241a5c4f85db0443a536d77d6",
  ROLE_ISSUER:
    "0x4be32e8849414d19186807008dabd451c1d87dae5f8e22f32f5ce94d486da842",
} as const;

export const RegulationType = { NONE: 0, REG_S: 1, REG_D: 2 } as const;
export const RegulationSubType = {
  NONE: 0,
  REG_D_506_B: 1,
  REG_D_506_C: 2,
} as const;
