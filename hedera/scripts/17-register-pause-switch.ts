// Registers IssuerPauseSwitch as an external pause on the bond. Same
// pattern as 03-register-control-list.ts.
//
// Run: npm run hedera:register-pause-switch

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { externalPauseManagementAbi } from "../src/abi.js";
import { confirmTransaction } from "../../shared/src/tx.js";

async function main() {
  const bondAddress = process.env.BOND_ADDRESS as `0x${string}` | undefined;
  const pauseSwitchAddress = process.env.PAUSE_SWITCH_ADDRESS as `0x${string}` | undefined;
  if (!bondAddress || !pauseSwitchAddress) {
    throw new Error(
      "Set BOND_ADDRESS and PAUSE_SWITCH_ADDRESS (from 16-deploy-pause-switch.ts) in .env.",
    );
  }

  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();

  const alreadyListed = await publicClient.readContract({
    address: bondAddress,
    abi: externalPauseManagementAbi,
    functionName: "isExternalPause",
    args: [pauseSwitchAddress],
  });
  if (alreadyListed) {
    console.log(`${pauseSwitchAddress} is already registered on ${bondAddress}. Nothing to do.`);
    return;
  }

  console.log(`Registering ${pauseSwitchAddress} as an external pause on ${bondAddress}...`);
  const { request } = await publicClient.simulateContract({
    address: bondAddress,
    abi: externalPauseManagementAbi,
    functionName: "addExternalPause",
    args: [pauseSwitchAddress],
    account: issuerAccount,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await confirmTransaction(publicClient, hash, "Registering the pause switch");
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);

  const count = await publicClient.readContract({
    address: bondAddress,
    abi: externalPauseManagementAbi,
    functionName: "getExternalPausesCount",
  });
  console.log(`Bond now has ${count} registered external pause(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
