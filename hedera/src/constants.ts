// Hedera testnet — Asset Tokenization Studio.
//
// Addresses from ATS docs/deployed-addresses.md (documents Smart Contract
// Version 4.0.0, 2026-01-22) — research-notes/task-d-hedera-ats.md [d10].
// The `externalControlList` facet was confirmed present in the ATS source
// tree from v3.0.0-ats (2025-12-17) onward, which brackets this deployment,
// so the published factory should carry it — CONFIRM with
// factory.isExternalControlList's presence / a successful
// addExternalControlList call before relying on this (see docs/BUILD-PLAN.md
// Day 1, resolved question 1). If it does not, the fallback is running
// `deploy:newBlr:hedera:testnet` from the ATS repo directly.

export const HEDERA_CHAIN_ID = 296;

export const ATS_TESTNET = {
  proxyAdmin: "0x76220dAa89df1d0be4C6997Dc401FCB98A586F6a",
  blrImplementation: "0xd53A586C1b11a5E7c34912a466e97c02Ad2d5786",
  blrProxy: "0xEFEF4CAe9642631Cfc6d997D6207Ee48fa78fe42",
  factoryImplementation: "0x3803219f13E23998FdDCa67AdA60EeB8E62eEEA8",
  factoryProxy: "0x5fA65CA30d1984701F10476664327f97c864A9D3",
} as const;

// From hashgraph/asset-tokenization-studio @ v.8.0.0-ats,
// packages/ats/contracts/scripts/domain/constants.ts and
// packages/ats/contracts/scripts/domain/atsRoles.generated.ts — transcribed
// directly from source, not inferred.
export const BOND_CONFIG_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000002" as const;

export const ATS_ROLES = {
  DEFAULT_ADMIN_ROLE:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  ROLE_CONTROL_LIST_MANAGER:
    "0xccf29bda8369877bcc921e38f30df86156a571ca5c5b8e777bf7ff75270313ea",
  ROLE_CORPORATE_ACTION:
    "0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd",
  ROLE_ISSUER:
    "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
} as const;

export const RegulationType = { NONE: 0, REG_S: 1, REG_D: 2 } as const;
export const RegulationSubType = {
  NONE: 0,
  REG_D_506_B: 1,
  REG_D_506_C: 2,
} as const;
