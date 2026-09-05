import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The beacon's ABI is read from Hardhat's compiled artifact rather than
// hand-transcribed like ens/src/abi.ts. Those fragments describe contracts
// deployed by other people, where the source of truth is their source; this
// one describes a contract in this repo, where the compiler output is the
// source of truth and a hand-copy could drift from it silently.
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

/** Shape of `ENSComplianceBeacon.ComplianceRecord`, as viem decodes it. */
export type ComplianceRecord = {
  resolver: `0x${string}`;
  node: `0x${string}`;
  kyc: string;
  jurisdiction: string;
  accreditationExpiry: string;
  lockupUntil: string;
  nameExpiry: bigint;
  authorized: boolean;
};

/**
 * Turns a record into the one-line "here's why" the demo needs.
 *
 * Deliberately distinguishes an expired name from one that never existed:
 * both leave `resolver` at the zero address, and conflating them would make
 * a revoked investor and a typo look identical on screen.
 */
export function describeRecord(record: ComplianceRecord, nowSeconds: bigint): string {
  const ZERO = "0x0000000000000000000000000000000000000000";

  if (record.resolver.toLowerCase() === ZERO) {
    if (record.nameExpiry === 0n) {
      return "BLOCKED: no such name — it was never registered under this parent.";
    }
    const when = new Date(Number(record.nameExpiry) * 1000).toISOString();
    return `BLOCKED: accreditation expired at ${when}, so the registry no longer resolves the name.`;
  }

  if (record.kyc !== "verified") {
    const shown = record.kyc === "" ? "(unset)" : `"${record.kyc}"`;
    return `BLOCKED: compliance.kyc is ${shown}, not "verified".`;
  }

  const remaining = record.nameExpiry - nowSeconds;
  const days = Number(remaining / 86_400n);
  return `ELIGIBLE: KYC verified, accreditation current for another ${days} day(s).`;
}
