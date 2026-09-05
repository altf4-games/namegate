import { toHex } from "viem";
import { packetToBytes } from "viem/ens";

/**
 * DNS-encodes a name for `authorizeTextRoles`/`authorizeNameRoles`, which
 * take `toName` as `bytes`, not a plain string. Pulled out of
 * 03-set-compliance.ts into its own function so it's independently unit
 * tested against a real fixture — see ens/test/dnsEncode.test.ts, which
 * checks it against the exact byte string this project already produced
 * and used successfully in a live Day 1 transaction.
 */
export function dnsEncodeName(name: string): `0x${string}` {
  return toHex(packetToBytes(name));
}
