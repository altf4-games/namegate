// Reads an investor's compliance state from ENS and ships it to Hedera over
// CCIP, in one transaction.
//
// Anyone can run this — the beacon does not check who the caller is, and the
// signer used here has no special standing. It is the issuer key only because
// that is the key this repo already has funded. That is the whole point: if a
// judge does not believe the record says what we say it says, they can call
// publish() themselves and get the same result.
//
// Delivery to Hedera takes minutes. The tx returning here means the message
// was accepted by the router, not that it has landed — track it at
// https://ccip.chain.link/msg/<messageId>.
//
// The address a verdict binds to is NEVER passed in — the beacon reads it
// from the registry. Publishing someone else's name only republishes the
// truth about that name; it cannot point that name's verdict at your address.
//
// Run: npm run ens:beacon-publish -- investora

import { decodeEventLog } from "viem";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import {
  beaconAbi,
  requireBeaconAddress,
  describeRecord,
  type ComplianceRecord,
} from "../src/beacon.js";
import { confirmTransaction } from "../../shared/src/tx.js";

// Sent on top of the quoted fee to absorb a fee change between quoting and
// mining. The contract refunds the unused remainder, so this is not a tip.
const FEE_BUFFER_BPS = 2000n; // 20%

async function main() {
  const label = process.argv[2];
  if (!label) {
    throw new Error("Usage: npm run ens:beacon-publish -- <label>   (e.g. investora)");
  }

  const beacon = requireBeaconAddress();
  const abi = beaconAbi();
  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  const record = (await publicClient.readContract({
    address: beacon,
    abi: abi as never,
    functionName: "readCompliance",
    args: [label],
  })) as ComplianceRecord;

  const block = await publicClient.getBlock();

  console.log(`Beacon:   ${beacon}`);
  console.log(`Label:    ${label}`);
  console.log(`Owner:    ${record.owner}  (read from the registry, not supplied)`);
  console.log(`Caller:   ${account.address}`);
  console.log();
  console.log(`What ENS currently says: ${describeRecord(record, block.timestamp)}`);
  console.log(`Publishing authorized=${record.authorized} to Hedera.`);
  console.log();

  const fee = (await publicClient.readContract({
    address: beacon,
    abi: abi as never,
    functionName: "quote",
    args: [label],
  })) as bigint;

  const value = fee + (fee * FEE_BUFFER_BPS) / 10_000n;
  console.log(`CCIP fee quote: ${fee} wei (sending ${value}, remainder refunded)`);

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < value) {
    throw new Error(
      `Caller has ${balance} wei but needs at least ${value}. Fund ${account.address} with Sepolia ETH.`,
    );
  }

  // Simulate first so a revert surfaces as a decoded error here rather than
  // as a failed transaction that has already cost gas.
  const { request } = await publicClient.simulateContract({
    address: beacon,
    abi: abi as never,
    functionName: "publish",
    args: [label],
    account,
    value,
  });

  const hash = await walletClient.writeContract(request as never);
  console.log(`Publish tx: ${hash}`);

  const receipt = await confirmTransaction(publicClient, hash, "publish()");
  console.log(`Mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);

  let messageId: string | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== beacon.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: abi as never, data: log.data, topics: log.topics });
      if (decoded.eventName === "CompliancePublished") {
        const args = decoded.args as unknown as {
          messageId: string;
          owner: string;
          authorized: boolean;
          fee: bigint;
        };
        messageId = args.messageId;
        console.log();
        console.log(`CCIP message id: ${args.messageId}`);
        console.log(`Bound to owner:       ${args.owner}`);
        console.log(`Published authorized: ${args.authorized}`);
        console.log(`Fee actually paid:    ${args.fee} wei`);
      }
    } catch {
      // Not one of ours; ignore.
    }
  }

  if (!messageId) {
    throw new Error(
      "Transaction succeeded but no CompliancePublished event was found. " +
        "The message may not have been sent — inspect the tx before trusting it.",
    );
  }

  console.log();
  console.log(`Track delivery: https://ccip.chain.link/msg/${messageId}`);
  console.log("Delivery to Hedera takes minutes. This tx only proves the router accepted it.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
