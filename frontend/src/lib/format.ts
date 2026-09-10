/** `0x9f2a...11c4` — never the full address, so cards read as UI, not a dump. */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** `0x8a12...ef90` for any 32-byte hash — same truncation rule as addresses. */
export function shortenHash(hash: string): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

/** Unix seconds -> `YYYY-MM-DD`, UTC. Matches how compliance dates are written. */
export function formatDate(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 10);
}

/**
 * Tinybar (HBAR's native 8-decimal EVM unit — see CouponDistributor.sol's
 * header) to a human HBAR string. Never divide by 1e18 here: that's the
 * 18-decimal "weibar" scale eth_getBalance reports over the JSON-RPC relay,
 * a real and previously-hit bug in this project (see
 * hedera/test/live/couponLive.test.ts).
 */
export function formatTinybarAsHbar(tinybar: bigint): string {
  return (Number(tinybar) / 1e8).toFixed(4);
}

/**
 * Tinybar valued in USD at a live HBAR/USD price (whole cents per HBAR, from
 * the Chainlink feed). Returns `null` when there's no price or nothing to
 * value, so callers can just skip the "≈ $x" suffix rather than render "$0.00".
 */
export function formatTinybarAsUsd(tinybar: bigint, hbarUsdCents: bigint): string | null {
  if (tinybar <= 0n || hbarUsdCents <= 0n) return null;
  const usd = (Number(tinybar) / 1e8) * (Number(hbarUsdCents) / 100);
  return `$${usd.toFixed(2)}`;
}

/** `nowSeconds` is a param, not `Date.now()`, so this stays pure and testable. */
export function secondsUntil(target: bigint, nowSeconds: bigint): bigint {
  return target - nowSeconds;
}
