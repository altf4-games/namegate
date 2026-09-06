// Asks the BOND ITSELF whether a transfer from an address would be allowed —
// not the mirror directly. This is the actual demo beat: ATS's own
// canTransferFrom is what a wallet or exchange would call before attempting
// a real transfer, and it reaches the mirror only through
// _isAbleToAccess -> _isExternallyAuthorized -> every registered external
// control list's isAuthorized(). Checking here proves the whole chain,
// not just the mirror in isolation.
//
// Returns EIP-1066 status codes. The two this project cares about:
//   0x51 TransferSuccess     — canTransferFrom would allow it
//   0x50 TransferFailure     — canTransferFrom would allow it, control-list check aside
// ATS's own reason codes (bytes32) name the exact facet that blocked it.
//
// Run: npm run hedera:check-bond-access -- 0xAddress [0xToAddress]

import { publicClient } from "../src/client.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const canTransferFromAbi = [
  {
    type: "function",
    name: "canTransferFrom",
    stateMutability: "view",
    inputs: [
      { name: "_from", type: "address" },
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
      { name: "_data", type: "bytes" },
    ],
    outputs: [
      { name: "", type: "bool" },
      { name: "", type: "bytes1" },
      { name: "", type: "bytes32" },
    ],
  },
] as const;

async function main() {
  const from = process.argv[2];
  const to = process.argv[3] ?? from;
  if (!from) {
    throw new Error("Usage: npm run hedera:check-bond-access -- <fromAddress> [toAddress]");
  }

  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const [allowed, statusCode, reason] = await publicClient.readContract({
    address: bond,
    abi: canTransferFromAbi,
    functionName: "canTransferFrom",
    args: [from as `0x${string}`, to as `0x${string}`, 1n, "0x"],
  });

  console.log(`Bond:  ${bond}`);
  console.log(`From:  ${from}`);
  console.log(`To:    ${to}`);
  console.log();
  console.log(`canTransferFrom: ${allowed}`);
  console.log(`EIP-1066 status: ${statusCode}`);
  console.log(`Reason code:     ${reason}`);
  console.log();
  console.log(
    allowed
      ? "This is the full chain working: ENS -> beacon -> CCIP -> mirror -> bond, checked at the bond's own entry point."
      : "Blocked. If isAuthorized on the mirror is true for this address, the block " +
          "is coming from somewhere else in the bond (a different facet, a hold, a pause) — " +
          "check hedera:mirror-read to isolate which layer is responsible.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
