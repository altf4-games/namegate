// Reads the mirror's live authorization state for an address on Hedera —
// the actual value ATS's transfer path will get from isAuthorized(address).
//
// Run: npm run hedera:mirror-read -- 0xInvestorAddress

import { publicClient } from "../src/client.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const artifactPath = fileURLToPath(
  new URL(
    "../../artifacts/contracts/hedera/ENSComplianceMirror.sol/ENSComplianceMirror.json",
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
  const address = process.argv[2];
  if (!address) {
    throw new Error("Usage: npm run hedera:mirror-read -- <address>");
  }

  const mirror = requireEnv("MIRROR_ADDRESS") as `0x${string}`;
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as { abi: unknown[] };

  const [authorized, stale, maxStaleness] = await Promise.all([
    publicClient.readContract({
      address: mirror,
      abi: artifact.abi as never,
      functionName: "isAuthorized",
      args: [address],
    }),
    publicClient.readContract({
      address: mirror,
      abi: artifact.abi as never,
      functionName: "staleness",
      args: [address],
    }),
    publicClient.readContract({
      address: mirror,
      abi: artifact.abi as never,
      functionName: "maxStaleness",
    }),
  ]);

  console.log(`Mirror:  ${mirror}`);
  console.log(`Address: ${address}`);
  console.log();
  console.log(`isAuthorized: ${authorized}`);
  if ((stale as bigint) === 2n ** 256n - 1n) {
    console.log("staleness:    never authorized");
  } else {
    console.log(`staleness:    ${stale}s (max ${maxStaleness}s)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
