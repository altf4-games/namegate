// Issuer self-revocation on a verified compliance field — "not even the
// issuer can quietly change it once it's verified."
//
// Requires 14-migrate-issuer-to-per-name-roles.ts to have run first. Before
// that migration, the issuer's write power came from one grant at
// EnhancedAccessControl's ROOT_RESOURCE, which ORs into every name
// unconditionally — a per-name revoke against it is a silent no-op (this
// was caught live: an earlier version of this script "succeeded" against
// ROOT_RESOURCE and changed nothing). Post-migration, the issuer's power is
// the wildcard ROLE_SET_TEXT on resource(node, 0) (the "any key, this node"
// resource — see PermissionedResolver.sol's onlyPartRoles modifier), which
// CAN be revoked per-name. Locking one field means:
//   1. Explicitly re-grant the issuer its own per-key ROLE_SET_TEXT on every
//      OTHER compliance key (authorizeTextRoles), so those keep working
//      through the specific-key check instead of the wildcard fallback.
//   2. Revoke any specific per-key ROLE_SET_TEXT grant the issuer holds for
//      the LOCKED key — needed because --unlock grants exactly this, so a
//      lock -> unlock -> lock cycle would otherwise leave that grant
//      standing (also caught live, in the regression test this script ships
//      alongside).
//   3. Revoke the issuer's wildcard ROLE_SET_TEXT on resource(node, 0)
//      (authorizeNameRoles) — closes the fallback path so nothing is left
//      granting the locked key.
//
// This deliberately does NOT touch ROLE_SET_TEXT_ADMIN (the separate bit
// that authorizes granting/revoking ROLE_SET_TEXT), so the issuer keeps the
// power to explicitly RE-authorize itself for the locked key later — the
// re-verification path. Re-verification is then a distinct, auditable
// on-chain action (authorize-compliance-role), not a silent overwrite.
//
// Run:
//   npm run ens:lock-compliance-field -- investora kyc
//   npm run ens:lock-compliance-field -- investora kyc --unlock

import { namehash, isAddress } from "viem";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { sepolia } from "viem/chains";
import { permissionedResolverAbi } from "../src/abi.js";
import { COMPLIANCE_KEYS, PARENT_NAME, RESOLVER_ROLES } from "../src/constants.js";
import { dnsEncodeName } from "../src/dnsEncode.js";
import { confirmTransaction } from "../../shared/src/tx.js";
import { assertUsableLabel } from "../src/label.js";

const ROLE_TO_KEY: Record<string, string> = {
  kyc: COMPLIANCE_KEYS.kyc,
  jurisdiction: COMPLIANCE_KEYS.jurisdiction,
  "accreditation-expiry": COMPLIANCE_KEYS.accreditationExpiry,
  "lockup-until": COMPLIANCE_KEYS.lockupUntil,
};

async function main() {
  const [label, role, flag] = process.argv.slice(2);
  if (!label || !role) {
    console.error(
      "Usage: npm run ens:lock-compliance-field -- <label> <role> [--unlock]\n" +
        `  <role> is one of: ${Object.keys(ROLE_TO_KEY).join(", ")}`,
    );
    process.exit(1);
  }
  const lockedKey = ROLE_TO_KEY[role];
  if (!lockedKey) {
    throw new Error(
      `Unrecognized role "${role}". Must be one of: ${Object.keys(ROLE_TO_KEY).join(", ")}.`,
    );
  }
  if (flag !== undefined && flag !== "--unlock") {
    throw new Error(`Unrecognized option "${flag}". The only supported flag is --unlock.`);
  }
  const unlock = flag === "--unlock";

  assertUsableLabel(label);

  const issuerResolverAddress = process.env.ISSUER_RESOLVER_ADDRESS as `0x${string}` | undefined;
  if (!issuerResolverAddress) {
    throw new Error("Set ISSUER_RESOLVER_ADDRESS in .env (printed by 01-setup-namespace.ts).");
  }

  const fullName = `${label}.${PARENT_NAME}`;
  const dnsEncoded = dnsEncodeName(fullName);
  const walletClient = getWalletClient();
  const issuerAccount = getIssuerAccount();
  if (!isAddress(issuerAccount.address)) {
    throw new Error("Issuer account has no valid address.");
  }

  if (unlock) {
    console.log(
      `Re-verifying: explicitly re-authorizing the issuer to write "${lockedKey}" ` +
        `on ${fullName} again...`,
    );
    const hash = await walletClient.writeContract({
      address: issuerResolverAddress,
      abi: permissionedResolverAbi,
      functionName: "authorizeTextRoles",
      args: [dnsEncoded, lockedKey, issuerAccount.address, true],
      chain: sepolia,
      account: issuerAccount,
    });
    const receipt = await confirmTransaction(publicClient, hash, "Re-authorizing the issuer");
    console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);
    console.log(
      "\nThis is a distinct, auditable on-chain action, not a silent overwrite of the lock.",
    );
    return;
  }

  console.log(`Locking "${lockedKey}" on ${fullName} — not even the issuer will be able to write it.`);

  // Step 1: explicit per-key grants for every OTHER key, so they keep
  // working once the wildcard is gone.
  for (const key of Object.values(COMPLIANCE_KEYS)) {
    if (key === lockedKey) continue;
    console.log(`  Preserving issuer write access to "${key}"...`);
    const hash = await walletClient.writeContract({
      address: issuerResolverAddress,
      abi: permissionedResolverAbi,
      functionName: "authorizeTextRoles",
      args: [dnsEncoded, key, issuerAccount.address, true],
      chain: sepolia,
      account: issuerAccount,
    });
    await confirmTransaction(publicClient, hash, `Preserving access to ${key}`);
  }

  // Step 2: revoke any SPECIFIC per-key grant the issuer holds for the
  // locked key. Needed because --unlock grants exactly this (a per-key
  // resource(node, part) role) — without also revoking it here, a
  // lock -> unlock -> lock cycle leaves the issuer still authorized through
  // this narrower grant even after the wildcard below is gone. Caught live:
  // the first version of this script only revoked the wildcard, and a real
  // re-lock after --unlock silently failed to lock anything.
  console.log(`  Revoking any specific per-key grant for "${lockedKey}"...`);
  const revokeKeyHash = await walletClient.writeContract({
    address: issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "authorizeTextRoles",
    args: [dnsEncoded, lockedKey, issuerAccount.address, false],
    chain: sepolia,
    account: issuerAccount,
  });
  await confirmTransaction(publicClient, revokeKeyHash, `Revoking the per-key grant for ${lockedKey}`);

  // Step 3: revoke the wildcard ROLE_SET_TEXT. Only ROLE_SET_TEXT is
  // targeted — ROLE_SET_TEXT_ADMIN is left alone so the issuer keeps the
  // power to re-authorize itself later (the --unlock path above).
  console.log(`  Revoking the issuer's wildcard write access on ${fullName}...`);
  const hash = await walletClient.writeContract({
    address: issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "authorizeNameRoles",
    args: [dnsEncoded, RESOLVER_ROLES.SET_TEXT, issuerAccount.address, false],
    chain: sepolia,
    account: issuerAccount,
  });
  const receipt = await confirmTransaction(publicClient, hash, "Revoking the wildcard grant");
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);
  console.log(
    `\n"${lockedKey}" on ${fullName} is now locked. The issuer cannot write it until it ` +
      "explicitly re-authorizes itself with --unlock — a distinct, auditable action.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
