// Reads back what was written,
// with plain viem — no ENSjs needed. This is also the same read path the
// Sepolia beacon contract will use on-chain (docs/ARCHITECTURE.md), so if
// this script can't resolve a name, the beacon won't either.
//
// Run: npm run ens:read -- investora.namegate.eth

import { normalize } from "viem/ens";
import { publicClient } from "../src/client.js";
import { COMPLIANCE_KEYS } from "../src/constants.js";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: npm run ens:read -- <name>, e.g. investora.namegate.eth");
    process.exit(1);
  }

  const normalized = normalize(name);
  console.log(`Reading ${normalized}...\n`);

  const address = await publicClient.getEnsAddress({ name: normalized });
  console.log(`address: ${address ?? "(none)"}`);

  for (const [label, key] of Object.entries(COMPLIANCE_KEYS)) {
    const value = await publicClient.getEnsText({ name: normalized, key });
    console.log(`${key.padEnd(28)} -> ${value ?? "(unset)"}  [${label}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
