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
// ATS's own reason codes (bytes32) are Solidity custom-error selectors, not
// arbitrary opaque values — decode a surprising one by computing candidate
// selectors with viem's toFunctionSelector rather than guessing.
//
// TWO IMPORTANT CAVEATS, found while building this script:
//
// 1. canTransferFrom ALSO checks the CALLER's own compliance
//    (ERC1594StorageWrapper._isCompliant's `_checkSender` branch calls
//    _isAbleToAccess(_msgSender())), separate from `_from`'s. Calling this as
//    an uninvolved or unauthorized address will report AccountIsBlocked for
//    the CALLER, which has nothing to do with whether `_from` is compliant.
//    Pass --as to call as a specific, already-authorized address.
//
// 2. Hedera's Hashio relay rejects eth_call with a `from` address that has
//    no corresponding funded Hedera account ("Sender account not found") —
//    an investor address that has never received HBAR cannot be used as the
//    caller here at all, regardless of its authorization status on the
//    mirror. This is a Hashio/Hedera constraint, not a compliance result.
//
// Run: npm run hedera:check-bond-access -- 0xAddress [--to 0xToAddress] [--as 0xCallerAddress]

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

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const from = args[0];
  if (!from) {
    throw new Error(
      "Usage: npm run hedera:check-bond-access -- <fromAddress> [--to 0x...] [--as 0x...]",
    );
  }
  const to = parseFlag(args, "--to") ?? from;
  // Defaults to `from` itself, which only works if `from` has a funded
  // Hedera account — see the header. Use --as to call as a different,
  // already-funded and already-authorized address.
  const caller = parseFlag(args, "--as") ?? from;

  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const [allowed, statusCode, reason] = await publicClient.readContract({
    address: bond,
    abi: canTransferFromAbi,
    functionName: "canTransferFrom",
    args: [from as `0x${string}`, to as `0x${string}`, 1n, "0x"],
    account: caller as `0x${string}`,
  });

  console.log(`Bond:  ${bond}`);
  console.log(`From:  ${from}`);
  console.log(`To:    ${to}`);
  console.log(`As:    ${caller} (the caller — canTransferFrom also checks THIS address's own compliance)`);
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
