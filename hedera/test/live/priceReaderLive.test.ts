// LIVE regression test for the Chainlink HBAR/USD oracle integration.
// Confirms the deployed reader genuinely talks to a real, live, complete
// Chainlink round — not a hardcoded or stubbed price — and that the
// tinybar-to-cents conversion is internally consistent.
//
// Run: npm run test:live:hedera

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient } from "../../src/client.js";

const artifactPath = fileURLToPath(
  new URL("../../../artifacts/contracts/hedera/HbarUsdPriceReader.sol/HbarUsdPriceReader.json", import.meta.url),
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}

describe("HbarUsdPriceReader (live)", () => {
  const priceReader = requireEnv("PRICE_READER_ADDRESS") as `0x${string}`;
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as { abi: unknown[] };

  test("reads a real, positive, recently-updated HBAR/USD price", async () => {
    const [priceCents, updatedAt] = (await publicClient.readContract({
      address: priceReader,
      abi: artifact.abi,
      functionName: "latestHbarUsdCents",
    })) as [bigint, bigint];

    assert.ok(priceCents > 0n, "HBAR/USD price should be positive");
    // Sanity bound, not a pin to a specific value — HBAR's price moves, but
    // a value outside this range would mean the feed or decimals handling
    // is wrong, not that HBAR genuinely costs $1,000 or $0.0001.
    assert.ok(priceCents < 10_000n, `price of $${Number(priceCents) / 100} looks implausible for HBAR`);

    const ageSeconds = Math.floor(Date.now() / 1000) - Number(updatedAt);
    assert.ok(ageSeconds < 24 * 60 * 60, `feed round is ${ageSeconds}s old — should be within the reader's own staleness bound`);
  });

  test("tinybarToUsdCents is consistent with latestHbarUsdCents", async () => {
    const [priceCents] = (await publicClient.readContract({
      address: priceReader,
      abi: artifact.abi,
      functionName: "latestHbarUsdCents",
    })) as [bigint, bigint];

    const oneHbarInTinybar = 100_000_000n;
    const usdCentsForOneHbar = (await publicClient.readContract({
      address: priceReader,
      abi: artifact.abi,
      functionName: "tinybarToUsdCents",
      args: [oneHbarInTinybar],
    })) as bigint;

    assert.equal(
      usdCentsForOneHbar,
      priceCents,
      "converting exactly 1 HBAR should equal the raw price-per-HBAR reading",
    );
  });
});
