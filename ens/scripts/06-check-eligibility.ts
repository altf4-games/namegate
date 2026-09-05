// The ENS-side half of the demo beat, ahead of the beacon landing.
// Reads an investor subname's KYC status and registry
// expiry live, then runs the exact same evaluateEligibility() logic that's
// unit tested in ens/test/compliance.test.ts — so the demo's "here's why"
// answer is provably the same function the tests already checked, not a
// second, untested reimplementation.
//
// Run: npm run ens:check-eligibility -- investora

import { labelhash } from "viem/ens";
import { normalize } from "viem/ens";
import { publicClient } from "../src/client.js";
import { userRegistryAbi } from "../src/abi.js";
import { COMPLIANCE_KEYS, PARENT_NAME } from "../src/constants.js";
import { evaluateEligibility } from "../src/compliance.js";

async function main() {
  const label = process.argv[2];
  if (!label) {
    console.error("Usage: npm run ens:check-eligibility -- <label>");
    process.exit(1);
  }

  const userRegistryAddress = process.env.ISSUER_USER_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!userRegistryAddress) {
    throw new Error("Set ISSUER_USER_REGISTRY_ADDRESS in .env (printed by 01-setup-namespace.ts).");
  }

  const fullName = `${label}.${PARENT_NAME}`;
  const normalized = normalize(fullName);
  // anyId on the registry is the LABEL's own labelhash, not the full
  // multi-level ENS namehash of the dotted name — the registry doc says
  // "labelhash, tokenId, or resource" are interchangeable, and a labelhash
  // is keccak256 of the single label only (see PermissionedRegistry.sol's
  // top comment). Using namehash(fullName) here silently reads a different,
  // nonexistent entry (getExpiry returns 0) — caught live on 2026-09 while
  // registering investorc.
  const anyId = BigInt(labelhash(label));

  const [kycStatus, expirySeconds] = await Promise.all([
    publicClient.getEnsText({ name: normalized, key: COMPLIANCE_KEYS.kyc }),
    publicClient.readContract({
      address: userRegistryAddress,
      abi: userRegistryAbi,
      functionName: "getExpiry",
      args: [anyId],
    }),
  ]);

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const result = evaluateEligibility({
    kycStatus: kycStatus ?? undefined,
    expirySeconds,
    nowSeconds,
  });

  console.log(`${fullName}`);
  console.log(`  kyc status:     ${kycStatus ?? "(unset)"}`);
  console.log(`  registry expiry: ${new Date(Number(expirySeconds) * 1000).toISOString()}`);
  console.log(`  now:             ${new Date(Number(nowSeconds) * 1000).toISOString()}`);
  console.log(`\n  ${result.eligible ? "✅ ELIGIBLE" : "❌ BLOCKED"} — ${result.reason}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
