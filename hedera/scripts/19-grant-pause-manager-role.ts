// Grants the issuer ROLE_PAUSE_MANAGER on the bond. Needed because, unlike
// ROLE_CONTROL_LIST_MANAGER, this role was never granted at deploy time
// (02-deploy-bond.ts's roles config didn't include it — pausing wasn't part
// of the original design). The issuer holds DEFAULT_ADMIN_ROLE, confirmed
// live, which is the admin-of-every-role default in ATS's AccessControl
// facet, so it can grant this to itself.
//
// Run: npm run hedera:grant-pause-manager

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { accessControlAbi } from "../src/abi.js";
import { ATS_ROLES } from "../src/constants.js";
import { confirmTransaction } from "../../shared/src/tx.js";

async function main() {
  const bondAddress = process.env.BOND_ADDRESS as `0x${string}` | undefined;
  if (!bondAddress) throw new Error("Set BOND_ADDRESS in .env.");

  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();

  const alreadyHasRole = await publicClient.readContract({
    address: bondAddress,
    abi: accessControlAbi,
    functionName: "hasRole",
    args: [ATS_ROLES.ROLE_PAUSE_MANAGER, issuerAccount.address],
  });
  if (alreadyHasRole) {
    console.log(`${issuerAccount.address} already holds ROLE_PAUSE_MANAGER. Nothing to do.`);
    return;
  }

  console.log(`Granting ROLE_PAUSE_MANAGER to ${issuerAccount.address}...`);
  const { request } = await publicClient.simulateContract({
    address: bondAddress,
    abi: accessControlAbi,
    functionName: "grantRole",
    args: [ATS_ROLES.ROLE_PAUSE_MANAGER, issuerAccount.address],
    account: issuerAccount,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await confirmTransaction(publicClient, hash, "Granting ROLE_PAUSE_MANAGER");
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);

  const confirmed = await publicClient.readContract({
    address: bondAddress,
    abi: accessControlAbi,
    functionName: "hasRole",
    args: [ATS_ROLES.ROLE_PAUSE_MANAGER, issuerAccount.address],
  });
  console.log(`Verified hasRole(ROLE_PAUSE_MANAGER, issuer): ${confirmed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
