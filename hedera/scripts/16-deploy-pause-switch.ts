// Deploys IssuerPauseSwitch to Hedera testnet. Same pattern as
// 01-deploy-control-list.ts — bytecode straight from Hardhat's compiled
// artifact, deployed via viem rather than Hardhat's own script runner.
//
// Run: npm run hedera:deploy-pause-switch

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { confirmTransaction } from "../../shared/src/tx.js";

const artifactPath = fileURLToPath(
  new URL("../../artifacts/contracts/hedera/IssuerPauseSwitch.sol/IssuerPauseSwitch.json", import.meta.url),
);

async function main() {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
    abi: unknown[];
    bytecode: `0x${string}`;
  };

  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();
  console.log(`Deploying as ${issuerAccount.address}`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [issuerAccount.address],
    chain: undefined,
    account: issuerAccount,
  });
  const receipt = await confirmTransaction(publicClient, hash, "Pause switch deployment");
  if (!receipt.contractAddress) {
    throw new Error("No contractAddress in deployment receipt");
  }

  console.log(`IssuerPauseSwitch deployed at ${receipt.contractAddress}`);
  console.log(`tx ${hash} (block ${receipt.blockNumber})`);
  console.log(`\nSave to .env for the next scripts:`);
  console.log(`PAUSE_SWITCH_ADDRESS=${receipt.contractAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
