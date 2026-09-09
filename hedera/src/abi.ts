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
  // Confirmed against ats-v3.1.0-ats source
  // (layer_1/interfaces/externalControlLists/IExternalControlListManagement.sol)
  // — paginated, not a single flat getter. Used live to find a real bug: a
  // previous mirror deployment left registered as a second control list
  // after a redeploy, which silently blocked issue()/transfer for everyone
  // because every registered list must authorize an account — see
  // hedera/test/live/bondControlListLive.test.ts.
  {
    type: "function",
    name: "getExternalControlListsMembers",
    stateMutability: "view",
    inputs: [
      { name: "_pageIndex", type: "uint256" },
      { name: "_pageLength", type: "uint256" },
    ],
    outputs: [{ name: "members_", type: "address[]" }],
  },
] as const;

// Confirmed against real ATS source
// (facets/externalPauseManagement/IExternalPauseManagement.sol). Composition
// is OR, not AND — the token is paused if its own flag is set OR ANY listed
// external pause returns true — the opposite of external control lists'
// AND composition above. Getting that backwards would either do nothing or
// silently block every account, so IssuerPauseSwitch.sol is written to be a
// single, independent, additive pause source and nothing else.
export const externalPauseManagementAbi = [
  {
    type: "function",
    name: "addExternalPause",
    stateMutability: "nonpayable",
    inputs: [{ name: "_pause", type: "address" }],
    outputs: [{ name: "success_", type: "bool" }],
  },
  {
    type: "function",
    name: "removeExternalPause",
    stateMutability: "nonpayable",
    inputs: [{ name: "_pause", type: "address" }],
    outputs: [{ name: "success_", type: "bool" }],
  },
  {
    type: "function",
    name: "isExternalPause",
    stateMutability: "view",
    inputs: [{ name: "_pause", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getExternalPausesCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "externalPausesCount_", type: "uint256" }],
  },
  {
    type: "function",
    name: "getExternalPausesMembers",
    stateMutability: "view",
    inputs: [
      { name: "_pageIndex", type: "uint256" },
      { name: "_pageLength", type: "uint256" },
    ],
    outputs: [{ name: "members_", type: "address[]" }],
  },
] as const;

// Confirmed against real ATS source
// (facets/accessControl/IAccessControl.sol). grantRole/revokeRole require the
// CALLER to hold the admin role of `_role` (resolved dynamically via
// getRoleAdmin) — DEFAULT_ADMIN_ROLE is the default admin-of-every-role in
// ATS's AccessControl facet, confirmed live against the deployed bond.
export const accessControlAbi = [
  {
    type: "function",
    name: "grantRole",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_role", type: "bytes32" },
      { name: "_account", type: "address" },
    ],
    outputs: [{ name: "success_", type: "bool" }],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "_role", type: "bytes32" },
      { name: "_account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Confirmed against ats-v3.1.0-ats source directly — the docs this project
// started from (initializeCoupon/cancelCoupon/forceCancelCoupon) describe a
// DIFFERENT ATS version. v3.1.0-ats's coupon surface lives on IBond/IBondRead
// (layer_2/interfaces/bond/), not a separate Coupon.sol, and only exposes
// setCoupon plus the four read functions below.
export const bondErc20Abi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "_tokenHolder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ERC1594.issue — gated by ROLE_ISSUER or ROLE_AGENT (issuer already holds
  // ROLE_ISSUER from deploy). Checks the RECIPIENT's own compliance
  // (onlyCompliant(address(0), _tokenHolder, false) — checkSender=false, so
  // the caller's own compliance is never checked here, only the holder's).
  // Confirmed live: issuance to an unauthorized address reverts with
  // AccountIsBlocked for the holder, the same error canTransferFrom uses.
  {
    type: "function",
    name: "issue",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_tokenHolder", type: "address" },
      { name: "_value", type: "uint256" },
      { name: "_data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// CONFIRMED BUG, found live 2026-09-06: v3.1.0-ats's 5-field Coupon struct
// (recordDate, executionDate, rate, rateDecimals, period) is NOT what the
// deployed factory actually accepts — setCoupon reverted against it with an
// undecodable selector. There is no "v4.0.0-ats" git tag (confirmed: the
// published tags jump straight from v3.1.0-ats to v4.1.0-ats), so the
// deployed version's exact source cannot be diffed byte-for-byte the way
// every other struct on this project was. Resolved empirically instead: a
// simulateContract call using v4.1.0-ats's 8-field Coupon shape
// (recordDate, executionDate, startDate, endDate, fixingDate, rate,
// rateDecimals, rateStatus) SUCCEEDED against the real deployed bond. That
// is the shape below, confirmed by the chain accepting it, not by trusting
// either tag's docs.
export const bondCouponAbi = [
  // Gated by ROLE_CORPORATE_ACTION (issuer already holds it from deploy).
  // Three date pairs are validated: (startDate, endDate), (recordDate,
  // executionDate), (fixingDate, executionDate) — each must be non-decreasing
  // (Bond.sol's validateDates). recordDate AND fixingDate must EACH be
  // strictly future at call time (ScheduledTasksCommon.WrongTimestamp,
  // checked independently for both).
  {
    type: "function",
    name: "setCoupon",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_newCoupon",
        type: "tuple",
        components: [
          { name: "recordDate", type: "uint256" },
          { name: "executionDate", type: "uint256" },
          { name: "startDate", type: "uint256" },
          { name: "endDate", type: "uint256" },
          { name: "fixingDate", type: "uint256" },
          { name: "rate", type: "uint256" },
          { name: "rateDecimals", type: "uint8" },
          // RateCalculationStatus enum: 0 = PENDING, 1 = SET. Not checked by
          // _getCouponAmountFor at this version (confirmed by reading
          // BondStorageWrapper.sol — the amount formula never inspects this
          // field), but SET is the honest value for a coupon whose rate is
          // already final, which every coupon this project creates is.
          { name: "rateStatus", type: "uint8" },
        ],
      },
    ],
    outputs: [{ name: "couponID_", type: "uint256" }],
  },
  {
    type: "function",
    name: "getCoupon",
    stateMutability: "view",
    inputs: [{ name: "_couponID", type: "uint256" }],
    outputs: [
      {
        name: "registeredCoupon_",
        type: "tuple",
        components: [
          {
            name: "coupon",
            type: "tuple",
            components: [
              { name: "recordDate", type: "uint256" },
              { name: "executionDate", type: "uint256" },
              { name: "startDate", type: "uint256" },
              { name: "endDate", type: "uint256" },
              { name: "fixingDate", type: "uint256" },
              { name: "rate", type: "uint256" },
              { name: "rateDecimals", type: "uint8" },
              { name: "rateStatus", type: "uint8" },
            ],
          },
          { name: "snapshotId", type: "uint256" },
        ],
      },
    ],
  },
  // tokenBalance/decimals/recordDateReached are only populated once
  // recordDate has PASSED (block.timestamp > recordDate, strictly) — before
  // that every field but the nested coupon's own static data reads as
  // zero/false, not reverted. Note this version NESTS the whole coupon
  // struct rather than flattening rate/period fields into CouponFor
  // directly — a real, confirmed shape difference from v3.1.0-ats's layout.
  {
    type: "function",
    name: "getCouponFor",
    stateMutability: "view",
    inputs: [
      { name: "_couponID", type: "uint256" },
      { name: "_account", type: "address" },
    ],
    outputs: [
      {
        name: "couponFor_",
        type: "tuple",
        components: [
          { name: "tokenBalance", type: "uint256" },
          { name: "decimals", type: "uint8" },
          { name: "recordDateReached", type: "bool" },
          {
            name: "coupon",
            type: "tuple",
            components: [
              { name: "recordDate", type: "uint256" },
              { name: "executionDate", type: "uint256" },
              { name: "startDate", type: "uint256" },
              { name: "endDate", type: "uint256" },
              { name: "fixingDate", type: "uint256" },
              { name: "rate", type: "uint256" },
              { name: "rateDecimals", type: "uint8" },
              { name: "rateStatus", type: "uint8" },
            ],
          },
        ],
      },
    ],
  },
  // The exact fraction CouponDistributor pays out from:
  //   numerator / denominator
  //     = tokenBalance * nominalValue * rate * (endDate - startDate)
  //       ─────────────────────────────────────────────────────────
  //       10^(decimals + nominalValueDecimals + rateDecimals) * 365 days
  // Confirmed against v4.1.0-ats's BondStorageWrapper.sol._getCouponAmountFor
  // directly — the only change from v3.1.0-ats's formula is that `period`
  // is now computed as `endDate - startDate` rather than stored directly;
  // the decimal scaling still cancels exactly, so this fraction is a plain
  // amount in the bond's declared currency, not a token-decimals-scaled one.
  {
    type: "function",
    name: "getCouponAmountFor",
    stateMutability: "view",
    inputs: [
      { name: "_couponID", type: "uint256" },
      { name: "_account", type: "address" },
    ],
    outputs: [
      {
        name: "couponAmountFor_",
        type: "tuple",
        components: [
          { name: "numerator", type: "uint256" },
          { name: "denominator", type: "uint256" },
          { name: "recordDateReached", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getCouponCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "couponCount_", type: "uint256" }],
  },
] as const;
