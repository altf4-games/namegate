// Deploys ENSComplianceBeacon to Sepolia, reading bytecode from Hardhat's
// compiled artifact (run `npm run compile` first). Uses viem rather than
// Hardhat's script runner, which conflicts with this repo's `"type":
// "module"`.
//
// The beacon is wired at construction to the issuer's UserRegistry, the
// parent name's node, the CCIP router, the Hedera chain selector, and the
// Hedera control list. All five are immutable — a beacon that could be
// repointed at a different registry after deployment would let its owner
// swap in a registry they control and forge every record, which is exactly
// the trust the design is meant to remove.
//
// Run: npm run ens:deploy-beacon

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { namehash } from "viem/ens";
import { getContractAddress } from "viem";
import {
  publicClient as hederaPublicClient,
  getIssuerAccount as getHederaIssuerAccount,
} from "../../hedera/src/client.js";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { PARENT_NAME } from "../src/constants.js";
import { CCIP_SEPOLIA_ROUTER, CCIP_HEDERA_TESTNET_SELECTOR } from "../src/ccip.js";
import { confirmTransaction } from "../../shared/src/tx.js";

const artifactPath = fileURLToPath(
  new URL(
    "../../artifacts/contracts/sepolia/ENSComplianceBeacon.sol/ENSComplianceBeacon.json",
    import.meta.url,
  ),
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env — see .env.example.`);
  }
  return value;
}

async function main() {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
    abi: unknown[];
    bytecode: `0x${string}`;
  };

  const registry = requireEnv("ISSUER_USER_REGISTRY_ADDRESS") as `0x${string}`;
  // MIRROR_ADDRESS is deliberately not read from .env. Both contracts take
  // the other's address as an immutable constructor argument — the beacon's
  // receiver, the mirror's sourceSender — which is a genuine mutual
  // reference: neither can exist first with the real address of the other.
  //
  // Resolved by predicting the mirror's address before it exists. A plain
  // CREATE deployment's address is fully determined by the deployer's
  // address and nonce (no CREATE2 salt needed), so the Hedera operator's
  // NEXT contract address can be computed here, on Sepolia, before anything
  // is deployed on Hedera at all. hedera:deploy-mirror deploys immediately
  // after this and verifies it landed exactly here — if some other Hedera
  // transaction sneaks in from this account first, that script fails loudly
  // rather than silently producing a beacon that points at empty space.
  const hederaAccount = getHederaIssuerAccount();
  const hederaNonce = await hederaPublicClient.getTransactionCount({
    address: hederaAccount.address,
  });
  const receiver = getContractAddress({ from: hederaAccount.address, nonce: BigInt(hederaNonce) });
  const expectedResolver = requireEnv("ISSUER_RESOLVER_ADDRESS") as `0x${string}`;
  const parentNode = namehash(PARENT_NAME);
  // Generous relative to a simple mapping write, because the receiver has to
  // ABI-decode an 11-field payload with four dynamic strings, and Hedera's
  // gas accounting is not Ethereum's. Measure against the real receiver and
  // lower it once that exists.
  const destinationGasLimit = BigInt(process.env.DESTINATION_GAS_LIMIT ?? "400000");

  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  console.log(`Deploying ENSComplianceBeacon as ${account.address}`);
  console.log(`  registry:  ${registry}`);
  console.log(`  parent:    ${PARENT_NAME} (${parentNode})`);
  console.log(`  resolver:  ${expectedResolver} (pinned — records from any other are ignored)`);
  console.log(`  router:    ${CCIP_SEPOLIA_ROUTER}`);
  console.log(`  selector:  ${CCIP_HEDERA_TESTNET_SELECTOR}`);
  console.log(
    `  receiver:  ${receiver} (predicted ENSComplianceMirror address — ` +
      `Hedera operator ${hederaAccount.address} at nonce ${hederaNonce})`,
  );
  console.log(`  gas limit: ${destinationGasLimit}`);
  console.log();

  const hash = await walletClient.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode,
    account,
    chain: publicClient.chain,
    args: [
      registry,
      parentNode,
      expectedResolver,
      CCIP_SEPOLIA_ROUTER,
      CCIP_HEDERA_TESTNET_SELECTOR,
      receiver,
      destinationGasLimit,
    ],
  });

  console.log(`Deploy tx: ${hash}`);
  const receipt = await confirmTransaction(publicClient, hash, "Beacon deployment");
  if (!receipt.contractAddress) {
    throw new Error("Deployment succeeded but no contract address in the receipt.");
  }

  // Read the deployed contract back rather than trusting the receipt — this
  // catches a deploy that landed but was wired to the wrong addresses.
  const deployedRegistry = await publicClient.readContract({
    address: receipt.contractAddress,
    abi: artifact.abi as never,
    functionName: "registry",
  });
  const deployedParent = await publicClient.readContract({
    address: receipt.contractAddress,
    abi: artifact.abi as never,
    functionName: "parentNode",
  });

  console.log();
  console.log(`Deployed at:      ${receipt.contractAddress}`);
  console.log(`Gas used:         ${receipt.gasUsed}`);
  console.log(`Registry (read):  ${deployedRegistry}`);
  console.log(`Parent (read):    ${deployedParent}`);

  if ((deployedRegistry as string).toLowerCase() !== registry.toLowerCase()) {
    throw new Error("Deployed beacon's registry does not match what was passed.");
  }
  if (deployedParent !== parentNode) {
    throw new Error("Deployed beacon's parentNode does not match what was passed.");
  }

  console.log();
  console.log("Add to .env:");
  console.log(`BEACON_ADDRESS=${receipt.contractAddress}`);
  console.log();
  console.log(
    "Next: run `npm run hedera:deploy-mirror` immediately, with no other " +
      `transaction from ${hederaAccount.address} on Hedera in between — it ` +
      `must land at ${receiver} or this beacon's receiver is unreachable.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
