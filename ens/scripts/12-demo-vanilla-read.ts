// Demo beat: prove compliance state is readable with a stock ENS client,
// not a NameGate SDK. This deliberately does NOT import permissionedResolverAbi
// or anything else from ens/src — only the standard ENSIP-5 text(bytes32,string)
// resolver interface, which is byte-identical to ENSv1's. Any wallet, dapp, or
// library that already speaks ENS can read this the same way.
//
// Run:
//   npm run ens:demo-vanilla-read -- investora

import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";

// The full ENSIP-5 text-record read interface, hand-typed here instead of
// imported, to make the point concrete: this is the only ABI fragment a
// generic client needs.
const STANDARD_ENS_TEXT_ABI = [
  {
    name: "text",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

async function main() {
  const [label] = process.argv.slice(2);
  if (!label) {
    console.error("Usage: npm run ens:demo-vanilla-read -- <label>");
    process.exit(1);
  }

  const resolverAddress = process.env.ISSUER_RESOLVER_ADDRESS as `0x${string}` | undefined;
  if (!resolverAddress) {
    throw new Error("Set ISSUER_RESOLVER_ADDRESS in .env (printed by 01-setup-namespace.ts).");
  }
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Set SEPOLIA_RPC_URL in .env.");
  }

  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const fullName = `${label}.namegate.eth`;
  const node = namehash(fullName);

  console.log(`Reading ${fullName}'s compliance records with ONLY the standard ENSIP-5`);
  console.log(`text(bytes32,string) interface — no NameGate ABI, no NameGate SDK.\n`);

  const keys = ["compliance.kyc", "compliance.jurisdiction", "compliance.accreditation-expiry", "compliance.lockup-until"];
  for (const key of keys) {
    const value = await client.readContract({
      address: resolverAddress,
      abi: STANDARD_ENS_TEXT_ABI,
      functionName: "text",
      args: [node, key],
    });
    console.log(`  ${key.padEnd(32)} = ${value || "(empty)"}`);
  }

  console.log(
    "\nAny ENS-aware wallet or explorer (app.ens.domains, a plain ethers/viem " +
      "text() call) reads the exact same values — the compliance state is a " +
      "real ENS text record, not something only NameGate's own code can see.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
