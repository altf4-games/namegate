// The literal check the build plan
// names — "confirm addExternalControlList is callable" — as a runtime call
// against an already-deployed bond, independent of whether it was also
// registered at deploy time via 02-deploy-bond.ts. Useful later for
// swapping in a second control list without redeploying the bond.
//
// Run: npm run hedera:register-control-list

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { externalControlListManagementAbi } from "../src/abi.js";
import { confirmTransaction } from "../../shared/src/tx.js";

async function main() {
  const bondAddress = process.env.BOND_ADDRESS as `0x${string}` | undefined;
  const controlListAddress = process.env.ENS_CONTROL_LIST_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!bondAddress || !controlListAddress) {
    throw new Error(
      "Set BOND_ADDRESS (from 02-deploy-bond.ts) and ENS_CONTROL_LIST_ADDRESS " +
        "(from 01-deploy-control-list.ts) in .env.",
    );
  }

  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();

  const alreadyListed = await publicClient.readContract({
    address: bondAddress,
    abi: externalControlListManagementAbi,
    functionName: "isExternalControlList",
    args: [controlListAddress],
  });
  if (alreadyListed) {
    console.log(
      `${controlListAddress} is already registered on ${bondAddress} ` +
        "(likely from 02-deploy-bond.ts's deploy-time registration). Nothing to do.",
    );
    return;
  }

  console.log(`Registering ${controlListAddress} on bond ${bondAddress}...`);
  const hash = await walletClient.writeContract({
    address: bondAddress,
    abi: externalControlListManagementAbi,
    functionName: "addExternalControlList",
    args: [controlListAddress],
    chain: undefined,
    account: issuerAccount,
  });
  const receipt = await confirmTransaction(publicClient, hash, "Registering the control list");
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);

  const count = await publicClient.readContract({
    address: bondAddress,
    abi: externalControlListManagementAbi,
    functionName: "getExternalControlListsCount",
  });
  console.log(`Bond now has ${count} external control list(s) registered.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
