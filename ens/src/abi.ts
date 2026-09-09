// Minimal ABI fragments, transcribed from verified raw Solidity source
// (contracts-v2 @ main, 2026-09-04) — see research-notes/task-c-ensv2-writepath.md [c8].
// Only the functions NameGate actually calls. Not a full interface.

export const userRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" }, // IRegistry — 0x0 if none
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setSubregistry",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" }, // labelhash, tokenId, or EAC resource
      { name: "registry", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getExpiry",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [{ name: "expiry", type: "uint64" }],
  },
  // These two take a plain string LABEL, not an anyId — the registry's
  // interface mixes both conventions. `getResolver(uint256)` does not exist
  // and reverts, which is what sent us to IRegistry.sol source in the first
  // place. Both return the zero address for an EXPIRED name as well as an
  // unregistered one: the registry masks resolver and owner alike on expiry.
  {
    type: "function",
    name: "getResolver",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "findOwner",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getSubregistry",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
    ],
    outputs: [],
  },
  // IEnhancedAccessControl — confirmed public on UserRegistry via
  // contracts-v2/src/access-control/interfaces/IEnhancedAccessControl.sol.
  // Lets us PROVE non-transferability with a read instead of attempting an
  // actual (irreversible-ish) transfer: pass the token ID as `resource` and
  // ROLES.admin(CAN_TRANSFER) as `roleBitmap` — false means the address
  // cannot transfer this token, per PermissionedRegistry.sol's `_update`
  // override (see abi.ts ROLES comment for the exact revert condition).
  {
    type: "function",
    name: "hasRoles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const permissionedResolverAbi = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "calls", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "setters", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizeNameRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "toName", type: "bytes" }, // DNS-encoded
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
      { name: "grant", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "authorizeTextRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "toName", type: "bytes" },
      { name: "key", type: "string" },
      { name: "account", type: "address" },
      { name: "grant", type: "bool" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // EnhancedAccessControl's ROOT_RESOURCE (0x0) is a global fallback: any
  // role granted there ORs into every resource's effective roles and cannot
  // be scoped back down per-name (confirmed against contracts-v2's
  // EnhancedAccessControl.sol — hasRoles = rootRoles | resourceRoles). The
  // issuer's setup grant (01-setup-namespace.ts) is exactly this: ALL_ROLES
  // at ROOT_RESOURCE. Revoking a bit here removes it everywhere at once,
  // which is why per-investor locking requires backfilling explicit
  // per-name grants (authorizeNameRoles) BEFORE calling this.
  {
    type: "function",
    name: "revokeRootRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const verifiableFactoryAbi = [
  {
    type: "function",
    name: "deployProxy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "salt", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "ProxyDeployed",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "proxyAddress", type: "address", indexed: true },
      { name: "salt", type: "uint256", indexed: false },
      { name: "implementation", type: "address", indexed: false },
    ],
  },
] as const;

export const mockUsdcAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// Role bitmap constants — RegistryRolesLib, verified against raw source
// (ensdomains/contracts-v2 @ main, fetched 2026-09-06). Every role below is a
// (base, admin) pair EXCEPT ROLE_CAN_TRANSFER_ADMIN, which has no base
// counterpart at all — it's a single toggle bit that lives directly at the
// admin position (nybble 39). Confirmed by reading PermissionedRegistry.sol's
// `_update` override directly:
//
//   if (!hasRoles(tokenId, RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN, from)) {
//       revert TransferDisallowed(tokenId, from);
//   }
//
// So a token transfer reverts unless its CURRENT OWNER holds this exact bit.
// INVESTOR_ROLE_BITMAP below never grants it, which is what makes an
// investor's subname non-transferable — not an assumption, a read source
// confirms it, and 07-check-transfer-role.ts proves it live via hasRoles().
export const ROLES = {
  REGISTRAR: 1n << 0n, // root only — authorizes register/reserve
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
  UPGRADE: 1n << 124n,
} as const;

// Every "_ADMIN" variant is the base role shifted left by 128 bits.
export const admin = (role: bigint) => role << 128n;

export const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;

// The investor's role bitmap: they may point their own subname to a further
// subregistry (needed so `namegatedemo` investors can later be delegated
// their own scoped registry, if ever), but nothing else. Critically:
// - NO SET_RESOLVER — an investor who could set their own resolver could
//   forge their own compliance status. This is the entire security model.
// - NO transfer-related role — the allocation is non-transferable.
export const INVESTOR_ROLE_BITMAP =
  ROLES.SET_SUBREGISTRY | admin(ROLES.SET_SUBREGISTRY);
