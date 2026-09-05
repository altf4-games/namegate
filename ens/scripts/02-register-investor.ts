// Day 2 (docs/BUILD-PLAN.md), but scripted now while the setup logic is fresh.
//
// Registers one investor subname under the UserRegistry deployed by
// 01-setup-namespace.ts. Deliberately withholds:
//   - ROLE_SET_RESOLVER  (investor cannot repoint to a resolver where they
//                         could forge their own compliance status)
//   - any transfer role  (the allocation is non-transferable)
//
// Run: npm run ens:register-investor -- investora 0xInvestorAddress

import { publicClient, getWalletClient } from "../src/client.js";
import { userRegistryAbi, INVESTOR_ROLE_BITMAP } from "../src/abi.js";
import { RESERVED_LABELS } from "../src/constants.js";
import { sepolia } from "viem/chains";

async function main() {
  const [label, investorAddress] = process.argv.slice(2);
  if (!label || !investorAddress) {
    console.error(
      "Usage: npm run ens:register-investor -- <label> <investorAddress>",
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

  const oneYear = 365n * 24n * 60n * 60n;
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + oneYear;

  console.log(`Registering ${label}.namegate.eth -> ${investorAddress}`);
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
