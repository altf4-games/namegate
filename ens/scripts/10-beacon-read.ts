// Asks the deployed beacon what ENS says about an investor. Free: this is a
// view call, so it costs nothing and needs no signer.
//
// This is the "point at the record and show why" beat. The answer comes from
// the same contract that will send the cross-chain message, reading the same
// resolver in the same way, so what you see here is exactly what gets
// published — not a separate off-chain reimplementation that might disagree.
//
// Run: npm run ens:beacon-read -- investora

import { publicClient } from "../src/client.js";
import {
  beaconAbi,
  requireBeaconAddress,
  describeRecord,
  LOCKUP_UNPARSEABLE,
  type ComplianceRecord,
} from "../src/beacon.js";

async function main() {
  const label = process.argv[2];
  if (!label) {
    throw new Error("Usage: npm run ens:beacon-read -- <label>   (e.g. investora)");
  }

  const beacon = requireBeaconAddress();
  const abi = beaconAbi();

  const record = (await publicClient.readContract({
    address: beacon,
    abi: abi as never,
    functionName: "readCompliance",
    args: [label],
  })) as ComplianceRecord;

  const block = await publicClient.getBlock();
  const expectedResolver = (await publicClient.readContract({
    address: beacon,
    abi: abi as never,
    functionName: "expectedResolver",
  })) as `0x${string}`;

  console.log(`Beacon:   ${beacon}`);
  console.log(`Label:    ${label}`);
  console.log(`Node:     ${record.node}`);
  console.log(`Resolver: ${record.resolver}`);
  console.log(`Owner:    ${record.owner}  (from the registry — verdicts bind to this)`);
  console.log();
  console.log(`  compliance.kyc                  "${record.kyc}"`);
  console.log(`  compliance.jurisdiction         "${record.jurisdiction}"`);
  console.log(`  compliance.accreditation-expiry "${record.accreditationExpiry}"`);
  console.log(
    `  compliance.lockup-until         "${record.lockupUntil}"` +
      (record.lockupUntilTimestamp === LOCKUP_UNPARSEABLE
        ? "  <- MALFORMED, treated as locked"
        : record.lockupUntilTimestamp > 0n
          ? `  -> ${record.lockupUntilTimestamp} (parsed on-chain)`
          : "  (no lockup)"),
  );
  console.log(
    `  registry expiry                 ${record.nameExpiry}` +
      (record.nameExpiry > 0n
        ? ` (${new Date(Number(record.nameExpiry) * 1000).toISOString()})`
        : ""),
  );
  console.log();
  console.log(`authorized (on-chain): ${record.authorized}`);
  console.log(describeRecord(record, block.timestamp, expectedResolver));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
