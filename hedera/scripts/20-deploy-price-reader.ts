// Deploys HbarUsdPriceReader, pointed at the real Chainlink HBAR/USD Data
// Feed on Hedera testnet — confirmed live before writing the contract
// (decimals() = 8, description() = "HBAR / USD", a fresh round). Source:
// ed-marquez/hedera-example-chainlink-price-feeds's testnet address table,
// verified against the actual chain rather than trusted as documentation.
//
// Run: npm run hedera:deploy-price-reader

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { confirmTransaction } from "../../shared/src/tx.js";

const artifactPath = fileURLToPath(
  new URL("../../artifacts/contracts/hedera/HbarUsdPriceReader.sol/HbarUsdPriceReader.json", import.meta.url),
);

const HBAR_USD_FEED_TESTNET = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";
const MAX_STALENESS_SECONDS = 24n * 60n * 60n; // 1 day — generous for a testnet feed's own update cadence

async function main() {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
    abi: unknown[];
    bytecode: `0x${string}`;
  };

  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();
  console.log(`Deploying as ${issuerAccount.address}`);
  console.log(`Feed: ${HBAR_USD_FEED_TESTNET} (Chainlink HBAR/USD, Hedera testnet)`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [HBAR_USD_FEED_TESTNET, MAX_STALENESS_SECONDS],
    chain: undefined,
    account: issuerAccount,
  });
  const receipt = await confirmTransaction(publicClient, hash, "Price reader deployment");
  if (!receipt.contractAddress) {
    throw new Error("No contractAddress in deployment receipt");
  }

  console.log(`HbarUsdPriceReader deployed at ${receipt.contractAddress}`);
  console.log(`tx ${hash} (block ${receipt.blockNumber})`);

  // Read it back immediately — a successful deploy tx proves nothing about
  // whether the feed address is actually live and answering.
  const [priceCents] = await publicClient.readContract({
    address: receipt.contractAddress,
    abi: artifact.abi,
    functionName: "latestHbarUsdCents",
  }) as [bigint, bigint];
  console.log(`Verified live: 1 HBAR = $${(Number(priceCents) / 100).toFixed(4)}`);

  console.log(`\nSave to .env for the next scripts:`);
  console.log(`PRICE_READER_ADDRESS=${receipt.contractAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
