// One-time migration, run once against the live deployed resolver.
//
// The issuer's write power was granted entirely at EnhancedAccessControl's
// ROOT_RESOURCE (01-setup-namespace.ts: initialize(issuer, ALL_ROLES, [])).
// ROOT_RESOURCE is a global OR-fallback — a role granted there applies to
// every name this resolver will ever manage, and cannot be selectively
// revoked for one investor without affecting all of them (confirmed against
// real source: contracts-v2's EnhancedAccessControl.sol). That makes
// 13-lock-compliance-field.ts's per-name revoke a no-op on its own: the
// issuer's ROOT_RESOURCE grant still satisfies every check underneath it.
//
// This migration backfills an explicit per-name ROLE_SET_TEXT grant
// (resource(node, 0)) for every investor that currently matters to the live
// demo, THEN revokes ROLE_SET_TEXT from ROOT_RESOURCE — moving the issuer
// from "one global text-write grant" to "one explicit grant per investor."
// ROLE_SET_TEXT_ADMIN is left untouched throughout, so the issuer keeps the
// power to grant itself access again later (used by both
// 05-authorize-compliance-role.ts and 13-lock-compliance-field.ts --unlock).
//
// Order matters: every backfill grant below must land BEFORE the
// ROOT_RESOURCE revoke, or investors not yet backfilled would briefly lose
// issuer write access entirely.
//
// Run once: npm run ens:migrate-issuer-roles

import { getWalletClient, getIssuerAccount, publicClient } from "../src/client.js";
import { sepolia } from "viem/chains";
import { permissionedResolverAbi } from "../src/abi.js";
import { COMPLIANCE_KEYS, PARENT_NAME, RESOLVER_ROLES } from "../src/constants.js";
import { dnsEncodeName } from "../src/dnsEncode.js";
import { confirmTransaction } from "../../shared/src/tx.js";

// Every label with a real, non-expired owner as of this migration (confirmed
// live via findOwner — investorexpired is intentionally excluded, it is
// expired by design and has no owner to preserve access for). investora is
// intentionally handled separately: its compliance.kyc field was already
// locked by 13-lock-compliance-field.ts, so it gets per-key grants for the
// other three fields only, never the full node-level grant.
const FULL_ACCESS_LABELS = ["investorb", "investorc", "investorf"];
const PARTIAL_ACCESS_LABEL = "investora";
const PARTIAL_ACCESS_LOCKED_KEY = COMPLIANCE_KEYS.kyc;

async function main() {
  const issuerResolverAddress = process.env.ISSUER_RESOLVER_ADDRESS as `0x${string}` | undefined;
  if (!issuerResolverAddress) {
    throw new Error("Set ISSUER_RESOLVER_ADDRESS in .env.");
  }

  const walletClient = getWalletClient();
  const issuerAccount = getIssuerAccount();

  async function grantNameLevel(label: string) {
    const dnsEncoded = dnsEncodeName(`${label}.${PARENT_NAME}`);
    console.log(`  Backfilling full text-write access for ${label}.${PARENT_NAME}...`);
    const hash = await walletClient.writeContract({
      address: issuerResolverAddress,
      abi: permissionedResolverAbi,
      functionName: "authorizeNameRoles",
      args: [dnsEncoded, RESOLVER_ROLES.SET_TEXT, issuerAccount.address, true],
      chain: sepolia,
      account: issuerAccount,
    });
    await confirmTransaction(publicClient, hash, `Backfilling ${label}`);
  }

  console.log("Step 1/3: backfilling explicit per-name grants for unlocked investors...");
  for (const label of FULL_ACCESS_LABELS) {
    await grantNameLevel(label);
  }

  console.log(`Step 2/3: backfilling per-key grants for ${PARTIAL_ACCESS_LABEL} (all but the locked field)...`);
  const partialDnsEncoded = dnsEncodeName(`${PARTIAL_ACCESS_LABEL}.${PARENT_NAME}`);
  for (const key of Object.values(COMPLIANCE_KEYS)) {
    if (key === PARTIAL_ACCESS_LOCKED_KEY) continue;
    const hash = await walletClient.writeContract({
      address: issuerResolverAddress,
      abi: permissionedResolverAbi,
      functionName: "authorizeTextRoles",
      args: [partialDnsEncoded, key, issuerAccount.address, true],
      chain: sepolia,
      account: issuerAccount,
    });
    await confirmTransaction(publicClient, hash, `Backfilling ${PARTIAL_ACCESS_LABEL}'s ${key}`);
  }
  console.log(
    `  (${PARTIAL_ACCESS_LOCKED_KEY} intentionally NOT backfilled — this is the field ` +
      "13-lock-compliance-field.ts already locked.)",
  );

  console.log("Step 3/3: revoking the issuer's global ROOT_RESOURCE text-write grant...");
  const revokeHash = await walletClient.writeContract({
    address: issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "revokeRootRoles",
    args: [RESOLVER_ROLES.SET_TEXT, issuerAccount.address],
    chain: sepolia,
    account: issuerAccount,
  });
  const receipt = await confirmTransaction(publicClient, revokeHash, "Revoking the global grant");
  console.log(`Done. tx ${revokeHash} (block ${receipt.blockNumber})`);
  console.log(
    "\nThe issuer's text-write power is now per-investor, not global. Every future " +
      "registration (02-register-investor.ts) grants the new investor's name explicitly.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
