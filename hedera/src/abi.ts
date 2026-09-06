// Minimal ABI fragments for the factory deployed on Hedera testnet.
//
// CONFIRMED 2026-09-05: a deployBond built from v8.0.0-ats's IFactory.sol
// reverted with EMPTY return data against the live factory — a selector
// mismatch (ABI struct encoding is positional; field order differs by
// version), not a business-logic revert. This SecurityData field order is
// instead transcribed from v3.1.0-ats (tagged 2026-01-21, one day before
// this factory's documented 2026-01-22 deploy date — the closest available
// match; there's no exact "4.0.0" tag to confirm byte-for-byte). See
// hedera/src/constants.ts for the same caveat on role hashes.
//
// BondDetailsData, Rbac, ERC20MetadataInfo, and FactoryRegulationData are
// IDENTICAL in shape between v3.1.0-ats and v8.0.0-ats — only SecurityData's
// field order changed.

const rbacType = {
  type: "tuple[]",
  name: "rbacs",
  components: [
    { name: "role", type: "bytes32" },
    { name: "members", type: "address[]" },
  ],
} as const;

const securityDataType = {
  type: "tuple",
  name: "security",
  components: [
    { name: "arePartitionsProtected", type: "bool" },
    { name: "isMultiPartition", type: "bool" },
    { name: "resolver", type: "address" },
    {
      name: "resolverProxyConfiguration",
      type: "tuple",
      components: [
        { name: "key", type: "bytes32" },
        { name: "version", type: "uint256" },
      ],
    },
    rbacType,
    { name: "isControllable", type: "bool" },
    { name: "isWhiteList", type: "bool" },
    { name: "maxSupply", type: "uint256" },
    {
      name: "erc20MetadataInfo",
      type: "tuple",
      components: [
        { name: "name", type: "string" },
        { name: "symbol", type: "string" },
        { name: "isin", type: "string" },
        { name: "decimals", type: "uint8" },
      ],
    },
    { name: "clearingActive", type: "bool" },
    { name: "internalKycActivated", type: "bool" },
    { name: "externalPauses", type: "address[]" },
    { name: "externalControlLists", type: "address[]" },
    { name: "externalKycLists", type: "address[]" },
    { name: "erc20VotesActivated", type: "bool" },
    { name: "compliance", type: "address" },
    { name: "identityRegistry", type: "address" },
  ],
} as const;

export const factoryAbi = [
  {
    type: "function",
    name: "deployBond",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_bondData",
        type: "tuple",
        components: [
          securityDataType,
          {
            name: "bondDetails",
            type: "tuple",
            components: [
              { name: "currency", type: "bytes3" },
              { name: "nominalValue", type: "uint256" },
              { name: "nominalValueDecimals", type: "uint8" },
              { name: "startingDate", type: "uint256" },
              { name: "maturityDate", type: "uint256" },
            ],
          },
          { name: "proceedRecipients", type: "address[]" },
          { name: "proceedRecipientsData", type: "bytes[]" },
        ],
      },
      {
        name: "_factoryRegulationData",
        type: "tuple",
        components: [
          { name: "regulationType", type: "uint8" },
          { name: "regulationSubType", type: "uint8" },
          {
            name: "additionalSecurityData",
            type: "tuple",
            components: [
              { name: "countriesControlListType", type: "bool" },
              { name: "listOfCountries", type: "string" },
              { name: "info", type: "string" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "bondAddress_", type: "address" }],
  },
  // BondDeployed's event ABI isn't transcribed here — it carries the full
  // nested BondData/FactoryRegulationData structs, which would duplicate
  // the input types above for no benefit. The deploy script instead reads
  // the bond address via `simulateContract` before sending the real tx,
  // which is simpler and doesn't need log decoding at all.
] as const;

export const externalControlListManagementAbi = [
  {
    type: "function",
    name: "addExternalControlList",
    stateMutability: "nonpayable",
    inputs: [{ name: "_controlList", type: "address" }],
    outputs: [{ name: "success_", type: "bool" }],
  },
  // Confirmed against ats-v3.1.0-ats source
  // (layer_1/externalControlLists/ExternalControlListManagement.sol): both
  // gated by ROLE_CONTROL_LIST_MANAGER, both revert (ListedControlList /
  // UnlistedControlList) rather than returning false on a no-op call — so a
  // failed swap surfaces as a revert, not a silently ignored write.
  {
    type: "function",
    name: "removeExternalControlList",
    stateMutability: "nonpayable",
    inputs: [{ name: "_controlList", type: "address" }],
    outputs: [{ name: "success_", type: "bool" }],
  },
  {
    type: "function",
    name: "isExternalControlList",
    stateMutability: "view",
    inputs: [{ name: "_controlList", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getExternalControlListsCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "externalControlListsCount_", type: "uint256" }],
  },
] as const;
