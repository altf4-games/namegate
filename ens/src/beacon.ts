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
  /** The name's holder per the registry. Zero when expired or unregistered. */
  owner: `0x${string}`;
  node: `0x${string}`;
  kyc: string;
  jurisdiction: string;
  accreditationExpiry: string;
  lockupUntil: string;
  /** Zero means no lockup. MAX_UINT64 means the value was malformed. */
  lockupUntilTimestamp: bigint;
  nameExpiry: bigint;
  authorized: boolean;
};

/** Sentinel the contract returns for an unparseable date — see parseDate. */
export const LOCKUP_UNPARSEABLE = 2n ** 64n - 1n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Finds the reason a record would be blocked, or null if nothing blocks it.
 *
 * This EXPLAINS the contract's decision; it does not make one. The verdict
 * always comes from `record.authorized`, computed on-chain — see
 * describeRecord. Deriving the verdict here as well would give the demo two
 * implementations of the same rule that can silently disagree, which is
 * exactly the class of bug this project has already hit once.
 *
 * @param expectedResolver the beacon's pinned resolver, if known. Passing it
 *   lets an untrusted-resolver record be named as such instead of being
 *   reported as a plain expiry.
 */
export function explainBlock(
  record: ComplianceRecord,
  nowSeconds: bigint,
  expectedResolver?: `0x${string}`,
): string | null {
  if (record.resolver.toLowerCase() === ZERO_ADDRESS) {
    // Both cases leave the resolver at zero. Conflating them would make a
    // revoked investor and a mistyped label look identical on screen.
    if (record.nameExpiry === 0n) {
      return "no such name — it was never registered under this parent";
    }
    const when = new Date(Number(record.nameExpiry) * 1000).toISOString();
    return `accreditation expired at ${when}, so the registry no longer resolves the name`;
  }

  if (
    expectedResolver !== undefined &&
    record.resolver.toLowerCase() !== expectedResolver.toLowerCase()
  ) {
    return (
      `the name points at resolver ${record.resolver}, which is not the issuer's ` +
      `(${expectedResolver}). The beacon does not read records from an untrusted resolver`
    );
  }

  if (record.owner.toLowerCase() === ZERO_ADDRESS) {
    return "the name has no owner, so there is no address to authorize";
  }

  if (record.kyc !== "verified") {
    const shown = record.kyc === "" ? "(unset)" : `"${record.kyc}"`;
    return `compliance.kyc is ${shown}, not "verified"`;
  }

  if (record.lockupUntilTimestamp === LOCKUP_UNPARSEABLE) {
    return (
      `compliance.lockup-until is "${record.lockupUntil}", which is not a valid ` +
      `YYYY-MM-DD date. Unreadable lockups block rather than pass`
    );
  }

  if (record.lockupUntilTimestamp > nowSeconds) {
    const until = new Date(Number(record.lockupUntilTimestamp) * 1000)
      .toISOString()
      .slice(0, 10);
    return `KYC is verified, but the holding is locked up until ${until}`;
  }

  return null;
}

/**
 * Turns a record into the one-line "here's why" the demo needs.
 *
 * The verdict is `record.authorized` as computed on-chain; only the reason is
 * derived here. If the two ever disagree the mismatch is reported loudly
 * rather than papered over, because a screen showing the chain's verdict next
 * to a contradictory explanation is worse than an obvious error.
 */
export function describeRecord(
  record: ComplianceRecord,
  nowSeconds: bigint,
  expectedResolver?: `0x${string}`,
): string {
  const blockReason = explainBlock(record, nowSeconds, expectedResolver);

  if (record.authorized) {
    if (blockReason !== null) {
      return (
        `INCONSISTENT: the beacon reports authorized, but this tool computes a ` +
        `block because ${blockReason}. Trust the chain and treat this as a bug ` +
        `in the explanation, not in the verdict.`
      );
    }
    const days = Number((record.nameExpiry - nowSeconds) / 86_400n);
    return `ELIGIBLE: KYC verified, lockup lapsed, accreditation current for another ${days} day(s).`;
  }

  if (blockReason === null) {
    return (
      "INCONSISTENT: the beacon reports unauthorized, but this tool cannot " +
      "identify which condition failed. Inspect the record fields directly."
    );
  }
  return `BLOCKED: ${blockReason}.`;
}
