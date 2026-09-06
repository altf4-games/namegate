// Deploys ENSComplianceMirror to Hedera testnet, reading bytecode from
// Hardhat's compiled artifact (run `npm run compile` first).
//
// This REPLACES the plain owner-writable NameGateEnsControlList as the
// bond's compliance gate — ATS combines multiple registered control lists
// with AND (every one must return true), so running both at once would
// require both to separately agree, not add coverage. Swap it in with
// 05-swap-control-list.ts after this deploys; don't register both.
//
// Run: npm run hedera:deploy-mirror

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { publicClient as sepoliaPublicClient } from "../../ens/src/client.js";

const artifactPath = fileURLToPath(
  new URL(
    "../../artifacts/contracts/hedera/ENSComplianceMirror.sol/ENSComplianceMirror.json",
    import.meta.url,
  ),
);

// Hedera's own CCIP router — the mirror only accepts calls from this address.
const HEDERA_CCIP_ROUTER = "0x802C5F84eAD128Ff36fD6a3f8a418e339f467Ce4" as const;

// Sepolia's CCIP chain selector AS SEEN FROM HEDERA — not Hedera's own
// selector, which is what the beacon uses in the other direction. Verified
// live: the deployed Hedera router's isChainSupported(16015286601757825753)
// returns true.
const SEPOLIA_SOURCE_SELECTOR = 16015286601757825753n;

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

  const beaconAddress = requireEnv("BEACON_ADDRESS") as `0x${string}`;

  // The beacon predicted this deployment's address from the Hedera
  // operator's nonce BEFORE this contract existed — see
  // ens/scripts/09-deploy-beacon.ts. Read its receiver back now and refuse
  // to deploy if this run would not land there: silently deploying anyway
  // would produce a mirror the beacon can never actually reach, since its
  // receiver is immutable.
  const beaconArtifactAbi = [
    { type: "function", name: "receiver", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  ] as const;
  const expectedAddress = await sepoliaPublicClient.readContract({
    address: beaconAddress,
    abi: beaconArtifactAbi,
    functionName: "receiver",
  });
  const currentNonce = await publicClient.getTransactionCount({
    address: getIssuerAccount().address,
  });
  console.log(`Beacon expects its receiver at: ${expectedAddress}`);
  console.log(`This deployment will be the operator's nonce ${currentNonce} contract.\n`);
  // How long a Hedera-side authorization is trusted with no fresh message.
  // 24h by default: long enough that CCIP's own several-minute latency is a
  // rounding error, short enough that a revocation nobody re-published still
  // takes effect within a day even in the worst case.
  const maxStaleness = BigInt(process.env.MAX_STALENESS_SECONDS ?? "86400");

  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  console.log(`Deploying ENSComplianceMirror as ${account.address}`);
  console.log(`  router:          ${HEDERA_CCIP_ROUTER} (Hedera's CCIP router)`);
  console.log(`  source selector: ${SEPOLIA_SOURCE_SELECTOR} (Sepolia, as seen from Hedera)`);
  console.log(`  source sender:   ${beaconAddress} (the only trusted beacon)`);
  console.log(`  max staleness:   ${maxStaleness}s`);
  console.log();

  const hash = await walletClient.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode,
    account,
    chain: publicClient.chain,
    args: [HEDERA_CCIP_ROUTER, SEPOLIA_SOURCE_SELECTOR, beaconAddress, maxStaleness],
  });

  console.log(`Deploy tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`Deployment reverted. Receipt status: ${receipt.status}`);
  }
  if (!receipt.contractAddress) {
    throw new Error("Deployment succeeded but no contract address in the receipt.");
  }

  const deployedSender = await publicClient.readContract({
    address: receipt.contractAddress,
    abi: artifact.abi as never,
    functionName: "sourceSender",
  });
  if ((deployedSender as string).toLowerCase() !== beaconAddress.toLowerCase()) {
    throw new Error("Deployed mirror's sourceSender does not match BEACON_ADDRESS.");
  }

  if (receipt.contractAddress.toLowerCase() !== (expectedAddress as string).toLowerCase()) {
    throw new Error(
      `This mirror deployed at ${receipt.contractAddress}, but the beacon's ` +
        `immutable receiver is ${expectedAddress}. Some other transaction from ` +
        `${getIssuerAccount().address} landed between the beacon's prediction ` +
        "and this deployment. The beacon at BEACON_ADDRESS can never reach " +
        "this mirror — redeploy the beacon (which will predict a fresh " +
        "address) and deploy the mirror again immediately after.",
    );
  }

  console.log();
  console.log(`Deployed at: ${receipt.contractAddress}`);
  console.log(`Gas used:    ${receipt.gasUsed}`);
  console.log(`Verified:    sourceSender reads back as ${deployedSender}`);
  console.log(`Verified:    landed at the address the beacon's receiver expects`);
  console.log();
  console.log("Add to .env:");
  console.log(`MIRROR_ADDRESS=${receipt.contractAddress}`);
  console.log();
  console.log("Next: npm run hedera:swap-control-list");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
