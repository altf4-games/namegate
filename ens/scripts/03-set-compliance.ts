// Day 2 (docs/BUILD-PLAN.md). Sets compliance text records on an investor's
// subname, batched into one tx via multicall. Also demonstrates
// authorizeTextRoles — the on-brief ENSv2 mechanism ("letting an account
// edit only certain text records on a name") that scopes KYC writes to a
// named provider instead of leaving the record open to anyone with resolver
// admin rights.
//
// Run:
//   npm run ens:set-compliance -- investora \
//     --kyc verified --jurisdiction US --accreditation-expiry 2027-03-01 --lockup-until 2026-12-31

import { encodeFunctionData, namehash } from "viem";
import { publicClient, getWalletClient } from "../src/client.js";
import { permissionedResolverAbi } from "../src/abi.js";
import { PARENT_NAME } from "../src/constants.js";
import { selectComplianceUpdates } from "../src/compliance.js";
import { dnsEncodeName } from "../src/dnsEncode.js";
import { parseFlags } from "../../shared/src/cli.js";
import { sepolia } from "viem/chains";

async function main() {
  const [label, ...rest] = process.argv.slice(2);
  if (!label) {
    console.error(
      'Usage: npm run ens:set-compliance -- <label> --kyc verified --jurisdiction US ' +
        "--accreditation-expiry 2027-03-01 --lockup-until 2026-12-31",
    );
    process.exit(1);
  }
  const flags = parseFlags(rest);

  const issuerResolverAddress = process.env.ISSUER_RESOLVER_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!issuerResolverAddress) {
    throw new Error("Set ISSUER_RESOLVER_ADDRESS in .env.");
  }

  const fullName = `${label}.${PARENT_NAME}`;
  const node = namehash(fullName);

  const updates = selectComplianceUpdates(flags);
  const calls = updates.map(({ key, value }) =>
    encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [node, key, value],
    }),
  );

  if (calls.length === 0) {
    console.error("No values provided — pass at least one of --kyc / --jurisdiction / --accreditation-expiry / --lockup-until");
    process.exit(1);
  }

  console.log(`Setting ${calls.length} compliance record(s) on ${fullName}...`);
  const walletClient = getWalletClient();
  const hash = await walletClient.writeContract({
    address: issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "multicall",
    args: [calls],
    chain: sepolia,
    account: walletClient.account!,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);

  console.log(
    "\nTo scope future writes of compliance.kyc to a KYC-provider address " +
      "(on-brief for the ENS track), run:\n",
  );
  console.log(`  npm run ens:authorize-kyc-provider -- ${label} <kycProviderAddress>`);
  console.log(`  (toName, DNS-encoded, would be ${dnsEncodeName(fullName)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
