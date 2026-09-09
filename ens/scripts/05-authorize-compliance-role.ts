// The ENSv2 mechanic the ENS track
// brief names verbatim — "letting an account edit only certain text
// records on a name." Scopes write access to ONE compliance key to ONE
// named address at a time, instead of leaving every compliance.* key
// writable only by the issuer key (which still works, but doesn't
// demonstrate Enhanced Access Control at all).
//
// This generalizes over a single "KYC provider" role: any compliance key
// (kyc, jurisdiction, accreditation-expiry, lockup-until) can be scoped to
// its own address, so a real deployment can split compliance duties across
// genuinely separate roles — a KYC provider distinct from a jurisdiction
// attestor distinct from whoever administers lockups — instead of bundling
// every write power into one grant.
//
// This does not revoke the issuer's own ability to write the key — the
// issuer already holds ALL_ROLES on the resolver from setup. It ADDS a
// second, narrower-scoped writer.
//
// Run:
//   npm run ens:authorize-compliance-role -- investora kyc 0xKycProviderAddress
//   npm run ens:authorize-compliance-role -- investora jurisdiction 0xAttestorAddress
//   npm run ens:authorize-compliance-role -- investora lockup-until 0xLockupAdminAddress --revoke

import { namehash, isAddress } from "viem";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { sepolia } from "viem/chains";
import { permissionedResolverAbi } from "../src/abi.js";
import { COMPLIANCE_KEYS, PARENT_NAME } from "../src/constants.js";
import { dnsEncodeName } from "../src/dnsEncode.js";
import { confirmTransaction } from "../../shared/src/tx.js";
import { assertUsableLabel } from "../src/label.js";

// Maps the short CLI role name to the actual text-record key it scopes.
const ROLE_TO_KEY: Record<string, string> = {
  kyc: COMPLIANCE_KEYS.kyc,
  jurisdiction: COMPLIANCE_KEYS.jurisdiction,
  "accreditation-expiry": COMPLIANCE_KEYS.accreditationExpiry,
  "lockup-until": COMPLIANCE_KEYS.lockupUntil,
};

async function main() {
  const [label, role, providerAddress, flag] = process.argv.slice(2);
  if (!label || !role || !providerAddress) {
    console.error(
      "Usage: npm run ens:authorize-compliance-role -- <label> <role> <address> [--revoke]\n" +
        `  <role> is one of: ${Object.keys(ROLE_TO_KEY).join(", ")}`,
    );
    process.exit(1);
  }
  const key = ROLE_TO_KEY[role];
  if (!key) {
    throw new Error(
      `Unrecognized role "${role}". Must be one of: ${Object.keys(ROLE_TO_KEY).join(", ")}.`,
    );
  }
  // Was `flag !== "--revoke"`, which meant any typo — "--revok", "--remove"
  // — silently GRANTED write access instead of revoking it. Fail closed on
  // anything unrecognized rather than guessing at intent.
  if (flag !== undefined && flag !== "--revoke") {
    throw new Error(
      `Unrecognized option "${flag}". The only supported flag is --revoke; ` +
        "omit it to grant.",
    );
  }
  const grant = flag === undefined;

  assertUsableLabel(label);
  if (!isAddress(providerAddress)) {
    throw new Error(`"${providerAddress}" is not a valid address.`);
  }

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
      `"${key}" (role: ${role}) on ${fullName}...`,
  );

  const walletClient = getWalletClient();
  const issuerAccount = getIssuerAccount();
  const hash = await walletClient.writeContract({
    address: issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "authorizeTextRoles",
    args: [dnsEncoded, key, providerAddress as `0x${string}`, grant],
    chain: sepolia,
    account: issuerAccount,
  });
  const receipt = await confirmTransaction(publicClient, hash, "Authorizing the compliance role");
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);

  console.log(
    `\nnode (for reference): ${namehash(fullName)}\n` +
      `The address can now call setText(node, "${key}", ...) directly on the ` +
      `resolver, without needing the issuer's key — and, since the grant is ` +
      `scoped to this one key, still cannot write any other compliance.* field.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
