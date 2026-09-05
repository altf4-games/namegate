// Sets compliance text records on an investor's
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
import { PARENT_NAME, COMPLIANCE_KEYS } from "../src/constants.js";
import { userRegistryAbi } from "../src/abi.js";
import { labelhash } from "viem/ens";
import {
  selectComplianceUpdates,
  assertUpdatesValid,
  dateToUnixSeconds,
} from "../src/compliance.js";
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

  if (updates.length === 0) {
    console.error("No values provided — pass at least one of --kyc / --jurisdiction / --accreditation-expiry / --lockup-until");
    process.exit(1);
  }

  // Reject anything the on-chain parser would reject, before writing. An
  // unparseable date is not a cosmetic problem: the beacon treats it as a
  // lockup that never ends and blocks the investor permanently.
  assertUpdatesValid(updates);

  // compliance.accreditation-expiry is a human-readable mirror of the
  // registry's own expiry, which is what actually gates the name. If the two
  // disagree, the record a judge reads is not the one the system obeys — so
  // refuse rather than let them drift apart silently.
  const accreditation = updates.find((u) => u.key === COMPLIANCE_KEYS.accreditationExpiry);
  if (accreditation) {
    const registryAddress = process.env.ISSUER_USER_REGISTRY_ADDRESS as `0x${string}` | undefined;
    if (!registryAddress) {
      throw new Error(
        "Set ISSUER_USER_REGISTRY_ADDRESS in .env so --accreditation-expiry can be " +
          "checked against the registry expiry it is supposed to mirror.",
      );
    }
    const registryExpiry = await publicClient.readContract({
      address: registryAddress,
      abi: userRegistryAbi,
      functionName: "getExpiry",
      args: [BigInt(labelhash(label))],
    });
    const claimed = dateToUnixSeconds(accreditation.value);
    const actualDay = new Date(Number(registryExpiry) * 1000).toISOString().slice(0, 10);
    if (actualDay !== accreditation.value) {
      throw new Error(
        `--accreditation-expiry ${accreditation.value} does not match ${label}'s registry ` +
          `expiry of ${registryExpiry} (${actualDay}).\n\n` +
          "The registry expiry is what actually blocks the investor; the text record is " +
          "only a readable mirror of it. Letting them differ means the record on screen " +
          "contradicts the rule being enforced.\n\n" +
          `Either pass --accreditation-expiry ${actualDay}, or re-register the name with ` +
          "the expiry you want.",
      );
    }
    void claimed;
  }

  const calls = updates.map(({ key, value }) =>
    encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [node, key, value],
    }),
  );

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
