// Day 2 (docs/BUILD-PLAN.md): proves an investor's subname is
// non-transferable WITHOUT attempting an actual (irreversible-ish) token
// transfer. PermissionedRegistry.sol's `_update` override reverts a
// transfer unless the CURRENT OWNER holds ROLE_CAN_TRANSFER_ADMIN on that
// token (confirmed by reading the source directly — see ens/src/abi.ts's
// ROLES comment). hasRoles() is a public view, so this checks the exact
// condition the transfer path checks, live, with no state change.
//
// Run: npm run ens:check-transfer-role -- investora 0xInvestorAddress

import { labelhash } from "viem/ens";
import { publicClient } from "../src/client.js";
import { userRegistryAbi, ROLES } from "../src/abi.js";
import { PARENT_NAME } from "../src/constants.js";

async function main() {
  const [label, investorAddress] = process.argv.slice(2);
  if (!label || !investorAddress) {
    console.error("Usage: npm run ens:check-transfer-role -- <label> <investorAddress>");
    process.exit(1);
  }

  const userRegistryAddress = process.env.ISSUER_USER_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!userRegistryAddress) {
    throw new Error("Set ISSUER_USER_REGISTRY_ADDRESS in .env (printed by 01-setup-namespace.ts).");
  }

  const fullName = `${label}.${PARENT_NAME}`;
  // anyId is the LABEL's own labelhash, not a full-name namehash — see the
  // matching comment/fix in 06-check-eligibility.ts. hasRoles(anyId, ...) on
  // PermissionedRegistry resolves this internally via getResource(anyId),
  // per source (contracts-v2/src/registry/PermissionedRegistry.sol:374),
  // so any of {labelhash, tokenId, resource} works here — just not a
  // namehash, which points at a different, nonexistent entry entirely.
  const anyId = BigInt(labelhash(label));

  const canTransfer = await publicClient.readContract({
    address: userRegistryAddress,
    abi: userRegistryAbi,
    functionName: "hasRoles",
    args: [anyId, ROLES.CAN_TRANSFER_ADMIN, investorAddress as `0x${string}`],
  });

  console.log(`${fullName} owned by ${investorAddress}`);
  console.log(
    `  holds ROLE_CAN_TRANSFER_ADMIN: ${canTransfer} ` +
      `-> ${canTransfer ? "TRANSFERABLE (unexpected — check INVESTOR_ROLE_BITMAP)" : "non-transferable, as designed"}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
