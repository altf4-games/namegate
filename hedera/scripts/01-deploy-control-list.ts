// Day 1, Gate B (docs/BUILD-PLAN.md): deploys NameGateEnsControlList to
// Hedera testnet, reading bytecode straight from Hardhat's compiled
// artifact (run `npm run hedera:compile` first). Uses viem directly rather
// than Hardhat's own script runner — Hardhat 2's ts-node integration
// conflicts with this repo's `"type": "module"`, which the rest of the
// tooling needs.
//
// Run: npm run hedera:deploy-control-list

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";

const artifactPath = fileURLToPath(
  new URL(
    "../../artifacts/hedera/contracts/NameGateEnsControlList.sol/NameGateEnsControlList.json",
    import.meta.url,
  ),
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("No contractAddress in deployment receipt");
  }

  console.log(`NameGateEnsControlList deployed at ${receipt.contractAddress}`);
  console.log(`tx ${hash} (block ${receipt.blockNumber})`);
  console.log(`\nSave to .env for the next scripts:`);
  console.log(`ENS_CONTROL_LIST_ADDRESS=${receipt.contractAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
