// LIVE regression test for the issuer pause switch: registering
// IssuerPauseSwitch as an external pause must genuinely gate the bond, and
// unpausing must genuinely restore it — not leave the bond stuck paused, or
// registered-but-inert. Uses simulateContract (no real transactions, no
// state change) to check canTransferFrom before and after toggling.
//
// Leaves the switch UNPAUSED when done, regardless of pass/fail, so a
// failed test run never leaves the live bond paused for other testing.
//
// Run: npm run test:live:hedera

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../../src/client.js";
import { confirmTransaction } from "../../../shared/src/tx.js";

// Same shape as 07-check-bond-access.ts's local ABI (not exported centrally
// there either). canTransferFrom also checks the CALLER's own compliance,
// not just `_from`'s — passing investorA as both is what that script's own
// real run against this exact bond used successfully.
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

const artifactPath = fileURLToPath(
  new URL("../../../artifacts/contracts/hedera/IssuerPauseSwitch.sol/IssuerPauseSwitch.json", import.meta.url),
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}

describe("Issuer pause switch (live)", () => {
  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const pauseSwitch = requireEnv("PAUSE_SWITCH_ADDRESS") as `0x${string}`;
  const investorA = requireEnv("INVESTOR_A_ADDRESS") as `0x${string}`;
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as { abi: unknown[] };
  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();

  async function setPaused(paused: boolean) {
    const { request } = await publicClient.simulateContract({
      address: pauseSwitch,
      abi: artifact.abi,
      functionName: "setPaused",
      args: [paused],
      account: issuerAccount,
      // Fixed floor: Hashio has been seen under-estimating gas for this
      // one-SSTORE write, mining it, then rolling it back out of gas. If
      // that hits the unpause in the `after` hook, the bond is left paused
      // for every other test and the live app. 100k is ~3.5x the real cost.
      gas: 100_000n,
    });
    const hash = await walletClient.writeContract(request);
    await confirmTransaction(publicClient, hash, `Setting paused=${paused}`);
  }

  async function canTransfer(): Promise<boolean> {
    const [allowed] = await publicClient.readContract({
      address: bond,
      abi: canTransferFromAbi,
      functionName: "canTransferFrom",
      args: [investorA, investorA, 1n, "0x"],
      account: investorA,
    });
    return allowed;
  }

  after(async () => {
    // Always leave the switch unpaused, even if an assertion above failed.
    await setPaused(false);
  });

  test("pausing blocks transfers, unpausing restores them", async () => {
    const beforePause = await canTransfer();
    assert.equal(beforePause, true, "sanity check: investorA should be transfer-eligible before pausing");

    await setPaused(true);
    const whilePaused = await canTransfer();
    assert.equal(whilePaused, false, "the bond should reject transfers while the pause switch is on");

    await setPaused(false);
    const afterUnpause = await canTransfer();
    assert.equal(afterUnpause, true, "the bond should accept transfers again once unpaused");
  });
});
