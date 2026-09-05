// Node's built-in test runner. Run with: npm run test:unit
//
// confirmTransaction exists because viem's waitForTransactionReceipt resolves
// for REVERTED transactions, not just successful ones. Seven scripts in this
// repo relied on that call alone and printed "Done." for transactions that
// could have reverted and written nothing. These tests pin the distinction so
// the guard cannot quietly regress into a pass-through.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { confirmTransaction } from "../src/tx.js";

const HASH = "0xabc123" as `0x${string}`;

function clientReturning(status: string) {
  let calls = 0;
  return {
    calls: () => calls,
    client: {
      waitForTransactionReceipt: async ({ hash }: { hash: `0x${string}` }) => {
        calls += 1;
        assert.equal(hash, HASH, "the hash should be passed straight through");
        return { status, blockNumber: 123n, gasUsed: 45_000n };
      },
    },
  };
}

describe("confirmTransaction", () => {
  test("returns the receipt for a successful transaction", async () => {
    const { client } = clientReturning("success");
    const receipt = await confirmTransaction(client, HASH, "Doing the thing");
    assert.equal(receipt.status, "success");
    assert.equal(receipt.blockNumber, 123n);
  });

  test("throws for a reverted transaction instead of returning it", async () => {
    // The whole point: a mined-but-reverted transaction must not read as done.
    const { client } = clientReturning("reverted");
    await assert.rejects(
      () => confirmTransaction(client, HASH, "Doing the thing"),
      /REVERTED/,
    );
  });

  test("throws for any status that is not exactly 'success'", async () => {
    for (const status of ["", "failure", "pending", "SUCCESS", "Success"]) {
      const { client } = clientReturning(status);
      await assert.rejects(
        () => confirmTransaction(client, HASH, "Doing the thing"),
        /REVERTED/,
        `status "${status}" should not count as success`,
      );
    }
  });

  test("names the operation and the hash, so the error identifies what failed", async () => {
    const { client } = clientReturning("reverted");
    await assert.rejects(
      () => confirmTransaction(client, HASH, "Registering the subname"),
      (error: Error) =>
        error.message.includes("Registering the subname") && error.message.includes(HASH),
    );
  });

  test("says explicitly that nothing was written", async () => {
    // The failure mode being guarded against is someone reading the error and
    // assuming the write partially landed.
    const { client } = clientReturning("reverted");
    await assert.rejects(
      () => confirmTransaction(client, HASH, "x"),
      /Nothing\s+was written/,
    );
  });

  test("waits exactly once", async () => {
    const waiter = clientReturning("success");
    await confirmTransaction(waiter.client, HASH, "x");
    assert.equal(waiter.calls(), 1);
  });
});
