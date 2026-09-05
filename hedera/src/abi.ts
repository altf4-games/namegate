// Minimal ABI fragments, transcribed from IFactory.sol and
// IExternalControlListManagement.sol at hashgraph/asset-tokenization-studio
// @ v.8.0.0-ats (fetched 2026-09-05). Only what NameGate calls.

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
    { name: "resolver", type: "address" },
    { name: "maxSupply", type: "uint256" },
    {
      name: "resolverProxyConfiguration",
      type: "tuple",
      components: [
        { name: "key", type: "bytes32" },
        { name: "version", type: "uint256" },
      ],
    },
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
    rbacType,
    { name: "externalPauses", type: "address[]" },
    { name: "externalControlLists", type: "address[]" },
    { name: "externalKycLists", type: "address[]" },
    { name: "compliance", type: "address" },
    { name: "identityRegistry", type: "address" },
    { name: "arePartitionsProtected", type: "bool" },
    { name: "isMultiPartition", type: "bool" },
    { name: "isControllable", type: "bool" },
    { name: "isWhiteList", type: "bool" },
    { name: "clearingActive", type: "bool" },
    { name: "internalKycActivated", type: "bool" },
    { name: "erc20VotesActivated", type: "bool" },
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
