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

import { encodeFunctionData, namehash, toHex } from "viem";
import { packetToBytes } from "viem/ens";
import { publicClient, getWalletClient } from "../src/client.js";
import { permissionedResolverAbi } from "../src/abi.js";
import { COMPLIANCE_KEYS, PARENT_NAME } from "../src/constants.js";
import { sepolia } from "viem/chains";

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i]?.startsWith("--")) {
      out[argv[i]!.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return out;
}

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

  const values: Record<string, string | undefined> = {
    [COMPLIANCE_KEYS.kyc]: flags["kyc"],
    [COMPLIANCE_KEYS.jurisdiction]: flags["jurisdiction"],
    [COMPLIANCE_KEYS.accreditationExpiry]: flags["accreditation-expiry"],
    [COMPLIANCE_KEYS.lockupUntil]: flags["lockup-until"],
  };

  const calls = Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) =>
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
    "\nOptional (on-brief for the ENS track): scope future writes of " +
      "compliance.kyc to a KYC-provider address, so the issuer key isn't the " +
      "only thing that can update it:\n",
  );
  console.log(
    `  authorizeTextRoles(dnsEncodedName, "${COMPLIANCE_KEYS.kyc}", <kycProviderAddress>, true)`,
  );
  console.log(`  toName (DNS-encoded) = ${toHex(packetToBytes(fullName))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
