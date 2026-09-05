import { concat, keccak256, toBytes } from "viem";

/**
 * ENSIP-1 namehash of `label + "." + parent`, derived from the parent's
 * namehash rather than from the full dotted string.
 *
 * This mirrors `ENSComplianceBeacon.nodeFor` exactly, and exists so the
 * TypeScript and Solidity derivations can be tested against each other. A
 * silent divergence here would make the beacon read a node nobody ever wrote
 * to, which surfaces as an empty record rather than an error — the same class
 * of failure as the earlier labelhash/namehash mix-up.
 */
export function nodeForLabel(parentNode: `0x${string}`, label: string): `0x${string}` {
  return keccak256(concat([parentNode, keccak256(toBytes(label))]));
}
