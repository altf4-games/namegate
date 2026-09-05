// Day 2 (docs/BUILD-PLAN.md): the on-brief ENSv2 mechanic the ENS track
// brief names verbatim — "letting an account edit only certain text
// records on a name." Scopes write access to ONE compliance key to a named
// KYC-provider address, instead of leaving every compliance.* key writable
// only by the issuer key (which still works, but doesn't demonstrate
// Enhanced Access Control at all).
//
// This does not revoke the issuer's own ability to write the key — the
// issuer already holds ALL_ROLES on the resolver from setup. It ADDS a
// second, narrower-scoped writer.
//
// Run:
//   npm run ens:authorize-kyc-provider -- investora 0xKycProviderAddress
//   npm run ens:authorize-kyc-provider -- investora 0xKycProviderAddress --revoke

import { namehash } from "viem";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { sepolia } from "viem/chains";
import { permissionedResolverAbi } from "../src/abi.js";
import { COMPLIANCE_KEYS, PARENT_NAME } from "../src/constants.js";
import { dnsEncodeName } from "../src/dnsEncode.js";

async function main() {
  const [label, providerAddress, flag] = process.argv.slice(2);
  if (!label || !providerAddress) {
    console.error(
      "Usage: npm run ens:authorize-kyc-provider -- <label> <providerAddress> [--revoke]",
    );
    process.exit(1);
  }
  const grant = flag !== "--revoke";

  const issuerResolverAddress = process.env.ISSUER_RESOLVER_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!issuerResolverAddress) {
    throw new Error("Set ISSUER_RESOLVER_ADDRESS in .env (printed by 01-setup-namespace.ts).");
  }

  const fullName = `${label}.${PARENT_NAME}`;
  const dnsEncoded = dnsEncodeName(fullName);

  console.log(
    `${grant ? "Authorizing" : "Revoking"} ${providerAddress} to write ` +
      `"${COMPLIANCE_KEYS.kyc}" on ${fullName}...`,
  );

  const walletClient = getWalletClient();
  const issuerAccount = getIssuerAccount();
  const hash = await walletClient.writeContract({
    address: issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "authorizeTextRoles",
    args: [dnsEncoded, COMPLIANCE_KEYS.kyc, providerAddress as `0x${string}`, grant],
    chain: sepolia,
    account: issuerAccount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);

  console.log(
    `\nnode (for reference): ${namehash(fullName)}\n` +
      `The provider can now call setText(node, "${COMPLIANCE_KEYS.kyc}", ...) directly ` +
      `on the resolver, without needing the issuer's key.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
