import { normalize } from "viem/ens";
import { RESERVED_LABELS } from "./constants.js";

/**
 * Validates a single ENS label before it is registered or looked up.
 *
 * The failure this exists to prevent is silent. Every lookup in this system
 * keys off `keccak256(bytes(label))` — the registry's `getResolver`, the
 * beacon's `nodeFor`, the token id. Those are byte comparisons, so
 * "InvestorA" and "investora" are two unrelated names. Registering the first
 * and then reading the second returns a zero resolver, which the beacon
 * correctly reports as "no such name" — a confusing, entirely self-inflicted
 * result that looks like the registration silently failed.
 *
 * ENSIP-15 normalization is what resolvers and clients apply, so a label that
 * is not already in normalized form must be rejected at the door rather than
 * quietly transformed: transforming it would register a different name than
 * the caller typed, which is its own surprise.
 */
export function assertUsableLabel(label: string): string {
  if (label.length === 0) {
    throw new Error("Label is empty. Pass a single label such as \"investora\".");
  }

  if (label.includes(".")) {
    throw new Error(
      `"${label}" contains a dot. Pass only the label — the parent name is ` +
        "added for you, so use \"investora\", not \"investora.namegate.eth\".",
    );
  }

  let normalized: string;
  try {
    normalized = normalize(label);
  } catch (error) {
    throw new Error(
      `"${label}" is not a valid ENS label: ${(error as Error).message}`,
    );
  }

  if (normalized !== label) {
    throw new Error(
      `"${label}" is not in ENSIP-15 normalized form (it normalizes to ` +
        `"${normalized}"). Registering it as typed would create a name that ` +
        `nothing resolves, because every lookup hashes the label bytes ` +
        `directly. Use "${normalized}".`,
    );
  }

  if (RESERVED_LABELS.has(label)) {
    throw new Error(
      `"${label}" is reserved for ENSv1 migration — pick a different label ` +
        "(e.g. investora, investorb).",
    );
  }

  return label;
}
