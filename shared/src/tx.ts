/**
 * Waits for a transaction and throws unless it actually succeeded.
 *
 * viem's `waitForTransactionReceipt` resolves for REVERTED transactions as
 * well as successful ones — it only rejects on timeout or replacement. So
 * `const receipt = await waitForTransactionReceipt(...); console.log("Done")`
 * reports success for a transaction that did nothing, which is how a failed
 * write gets mistaken for a completed one and only surfaces much later when
 * something reads the state back and finds it empty.
 *
 * Every script that sends a transaction should route through this rather than
 * checking the status field itself, so the check cannot be forgotten in the
 * next script someone adds.
 */

type MinimalReceipt = {
  status: "success" | "reverted" | (string & {});
  blockNumber: bigint;
  gasUsed: bigint;
};

type ReceiptWaiter = {
  waitForTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<MinimalReceipt>;
};

export async function confirmTransaction<T extends MinimalReceipt>(
  client: { waitForTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<T> },
  hash: `0x${string}`,
  description: string,
): Promise<T> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(
      `${description} REVERTED.\n` +
        `  tx:    ${hash}\n` +
        `  block: ${receipt.blockNumber}\n` +
        `  gas:   ${receipt.gasUsed}\n\n` +
        "The transaction was mined but its effects were rolled back. Nothing " +
        "was written. Inspect the transaction on a block explorer for the " +
        "revert reason before assuming any state changed.",
    );
  }
  return receipt;
}

export type { MinimalReceipt, ReceiptWaiter };
