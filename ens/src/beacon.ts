import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export {
  type ComplianceRecord,
  LOCKUP_UNPARSEABLE,
  explainBlock,
  describeRecord,
} from "./beaconRecord.js";

// The beacon's ABI is read from Hardhat's compiled artifact rather than
// hand-transcribed like ens/src/abi.ts. Those fragments describe contracts
// deployed by other people, where the source of truth is their source; this
// one describes a contract in this repo, where the compiler output is the
// source of truth and a hand-copy could drift from it silently.
//
// This loader uses `node:fs` and only runs on the Node side (scripts,
// tests). The record type and the "why is this blocked" logic it operates
// on live in beaconRecord.ts, which has no such dependency and is safe for
// the frontend to import directly.
const artifactPath = fileURLToPath(
  new URL(
    "../../artifacts/contracts/sepolia/ENSComplianceBeacon.sol/ENSComplianceBeacon.json",
    import.meta.url,
  ),
);

type Artifact = { abi: readonly unknown[]; bytecode: `0x${string}` };

let cached: Artifact | undefined;

export function beaconArtifact(): Artifact {
  if (!cached) {
    try {
      cached = JSON.parse(readFileSync(artifactPath, "utf-8")) as Artifact;
    } catch {
      throw new Error(
        "Could not read the compiled ENSComplianceBeacon artifact. Run `npm run compile` first.",
      );
    }
  }
  return cached;
}

export function beaconAbi() {
  return beaconArtifact().abi;
}

export function requireBeaconAddress(): `0x${string}` {
  const address = process.env.BEACON_ADDRESS;
  if (!address) {
    throw new Error(
      "Missing BEACON_ADDRESS in .env. Deploy it first with `npm run ens:deploy-beacon`.",
    );
  }
  return address as `0x${string}`;
}
