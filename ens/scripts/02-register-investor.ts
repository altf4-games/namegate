// Registers one investor subname under the UserRegistry deployed by
// 01-setup-namespace.ts. Deliberately withholds:
//   - ROLE_SET_RESOLVER  (investor cannot repoint to a resolver where they
//                         could forge their own compliance status)
//   - any transfer role  (the allocation is non-transferable — see
//                         ens/src/abi.ts's ROLES comment for why omitting
//                         ROLE_CAN_TRANSFER_ADMIN is sufficient, confirmed
//                         against PermissionedRegistry.sol source)
//
// --accreditation-expiry sets the REGISTRY'S OWN expiry to that date, rather
// than storing a date string and comparing it later. Letting the name expire
// makes accreditation expiry an ENS property instead of an application-level
// convention. If omitted, defaults to 1 year out.
//
// --expires-in-seconds is a TESTING-ONLY escape hatch: --accreditation-expiry
// only has day granularity, so it can't demo the expiry actually flipping
// within a single session. This sets a real registry expiry N seconds out —
// wait that long, then run ens:beacon-read and watch it flip from
// ELIGIBLE to BLOCKED. Don't use this for a real investor registration.
//
// Run:
//   npm run ens:register-investor -- investorb 0xInvestorAddress
//   npm run ens:register-investor -- investorb 0xInvestorAddress --accreditation-expiry 2026-09-06
//   npm run ens:register-investor -- investorc 0xAddr --expires-in-seconds 90

import { publicClient, getWalletClient } from "../src/client.js";
import { userRegistryAbi, INVESTOR_ROLE_BITMAP } from "../src/abi.js";
import { RESERVED_LABELS } from "../src/constants.js";
import { parseExpiryFlag, resolveExpiry } from "../src/compliance.js";
import { sepolia } from "viem/chains";
import { confirmTransaction } from "../../shared/src/tx.js";

async function main() {
  const [label, investorAddress, flag, flagValue] = process.argv.slice(2);
  if (!label || !investorAddress) {
    console.error(
      "Usage: npm run ens:register-investor -- <label> <investorAddress> " +
        "[--accreditation-expiry YYYY-MM-DD]",
    );
    process.exit(1);
  }
  if (RESERVED_LABELS.has(label.toLowerCase())) {
    throw new Error(
      `"${label}" is reserved for ENSv1 migration — pick a different label ` +
        `(e.g. investora, investorb).`,
    );
  }

  const issuerResolverAddress = process.env.ISSUER_RESOLVER_ADDRESS as
    | `0x${string}`
    | undefined;
  const userRegistryAddress = process.env.ISSUER_USER_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!issuerResolverAddress || !userRegistryAddress) {
    throw new Error(
      "Set ISSUER_RESOLVER_ADDRESS and ISSUER_USER_REGISTRY_ADDRESS in .env " +
        "(printed by 01-setup-namespace.ts).",
    );
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const expiry = resolveExpiry(parseExpiryFlag(flag, flagValue), now);

  console.log(`Registering ${label}.namegate.eth -> ${investorAddress}`);
  console.log(`  expiry:     ${new Date(Number(expiry) * 1000).toISOString()} (== accreditation expiry)`);
  console.log(`  resolver:   ${issuerResolverAddress} (issuer-controlled, not investor's)`);
  console.log(`  role bitmap: ${INVESTOR_ROLE_BITMAP.toString(2)} (no SET_RESOLVER, no transfer)`);

  const walletClient = getWalletClient();
  const hash = await walletClient.writeContract({
    address: userRegistryAddress,
    abi: userRegistryAbi,
    functionName: "register",
    args: [
      label,
      investorAddress as `0x${string}`,
      "0x0000000000000000000000000000000000000000",
      issuerResolverAddress,
      INVESTOR_ROLE_BITMAP,
      expiry,
    ],
    chain: sepolia,
    account: walletClient.account!,
  });
  const receipt = await confirmTransaction(publicClient, hash, "Registering the subname");
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
