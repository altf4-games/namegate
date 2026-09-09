// ENSv2 Sepolia addresses.
//
// Source: ENS Labs deployments table, https://docs.ens.domains/learn/deployments/
// Cross-checked against live chain state on 2026-09-05 (research-notes/task-c-ensv2-writepath.md).
//
// DO NOT pull these from @ensdomains/ensjs@5.0.0-sepolia-fix.1 — its bundled
// config is dated 2026-05-26, lists Namechain-era contracts, and matches none
// of the addresses below. Two Sepolia deployments coexist; using the wrong
// set fails SILENTLY (names mint but never resolve). If ENS re-deploys during
// the Immunefi audit window (through 2026-09-14), re-verify every address
// here against the live docs page before building further.

export const SEPOLIA_CHAIN_ID = 11_155_111;

export const ENSV2_SEPOLIA = {
  // Unpermissioned `mint` — used to pay ENS registration fees on Sepolia.
  mockUSDC: "0x768f42455a2d082e23ceef7d51e5787c82d67a39",
  // Deploys UUPS proxies (resolver, UserRegistry) via CREATE2.
  verifiableFactory: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef",
  // commit() / register() for 2LDs under .eth
  ethRegistrar: "0xa88553f454b77203b0d036a05c894d555eaaa2cc",
  // setSubregistry() lives here — DO NOT skip calling it, or subnames
  // mint but never resolve (the classic silent failure).
  ethRegistry: "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2",
} as const;

// Labels reserved for ENSv1 migration — do not register these for demo data.
export const RESERVED_LABELS = new Set(["alice", "bob", "nick", "test"]);

export const PARENT_NAME = "namegate.eth";

// Compliance text record keys. ENSIP-5 imposes no key allowlist; these are
// namespaced under `compliance.*` by convention only.
export const COMPLIANCE_KEYS = {
  kyc: "compliance.kyc",
  jurisdiction: "compliance.jurisdiction",
  accreditationExpiry: "compliance.accreditation-expiry",
  lockupUntil: "compliance.lockup-until",
} as const;

// setText(bytes32,string,string) selector — byte-identical to ENSv1.
export const SET_TEXT_SELECTOR = "0x10f13a8c" as const;

// PermissionedResolver's EnhancedAccessControl role bits (confirmed against
// real source: contracts-v2/src/resolver/libraries/PermissionedResolverLib.sol).
// ROLE_SET_TEXT is the base "can call setText" bit; ROLE_SET_TEXT_ADMIN
// (that same bit shifted left 128) is the separate "can grant/revoke
// ROLE_SET_TEXT" bit — revoking the base bit from an account does not touch
// the admin bit, so an admin can lock its own write access to a key while
// keeping the power to re-authorize it later.
export const RESOLVER_ROLES = {
  SET_TEXT: 1n << 4n,
} as const;
