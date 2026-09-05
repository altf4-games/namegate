// Node's built-in test runner. Run with: npm run test:unit
//
// Unlike ens/src/client.ts, hedera/src/client.ts's publicClient/hederaTestnet
// don't require any env var at import time (only getWalletClient/
// getIssuerAccount do, lazily) — so this is safely importable and testable
// with zero setup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hederaTestnet } from "../src/client.js";

test("hederaTestnet chain id is 296 (testnet) — not 295 (mainnet) or 297 (previewnet)", () => {
  // A wrong chain id here would silently point every Hedera script at the
  // wrong network, so this is worth locking in as its own assertion
  // independent of hedera/test/constants.test.ts's HEDERA_CHAIN_ID check.
  assert.equal(hederaTestnet.id, 296);
});

test("hederaTestnet defaults to the public Hashio relay when HEDERA_RPC_URL is unset", () => {
  assert.equal(hederaTestnet.rpcUrls.default.http[0], process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api");
});

test("hederaTestnet is flagged as a testnet", () => {
  assert.equal(hederaTestnet.testnet, true);
});
