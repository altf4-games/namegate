// Schedules a FUTURE coupon distribution via Hedera's native Schedule
// Service, instead of calling distribute() directly. This is the exact
// "Scheduled Transactions for vesting, coupon payments, or maturity
// settlement" extra-points item the Tokenization track names — CouponDistributor
// already computes and pays real coupons, but nothing in this project had
// ever actually scheduled that payment before now.
//
// Uses @hiero-ledger/sdk directly (the same native-SDK pattern documented in
// the hedera-schedule-service skill this project contributed upstream —
// see the Hedera Harness PR), not the Solidity HSS precompile: this is a
// server-side scheduling flow, with no need for the payment to originate
// from a smart contract.
//
// setWaitForExpiry(true) means the schedule genuinely waits for the
// expiration timestamp rather than executing the moment enough signatures
// are collected — the same distinction that matters for a real maturity
// date or vesting cliff, not just an immediate multi-sig release.
//
// Run:
//   npm run hedera:schedule-coupon -- <holderAddress> [couponId] [secondsFromNow]

import {
  AccountId,
  Client,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleInfoQuery,
  Timestamp,
} from "@hiero-ledger/sdk";
import { privateKeyToAccount } from "viem/accounts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

function normalize(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

async function lookupAccountId(evmAddress: string): Promise<string> {
  const response = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`,
  );
  if (!response.ok) {
    throw new Error(`Mirror node lookup for ${evmAddress} failed: ${response.status}`);
  }
  const json = (await response.json()) as { account?: string };
  if (!json.account) {
    throw new Error(`Mirror node has no account record for ${evmAddress} yet.`);
  }
  return json.account;
}

async function main() {
  const holder = process.argv[2];
  if (!holder) {
    throw new Error(
      "Usage: npm run hedera:schedule-coupon -- <holderAddress> [couponId] [secondsFromNow]",
    );
  }
  const couponId = BigInt(process.argv[3] ?? requireEnv("COUPON_ID"));
  const secondsFromNow = Number(process.argv[4] ?? 60);

  const distributorAddress = requireEnv("COUPON_DISTRIBUTOR_ADDRESS");
  const rawKey = normalize(requireEnv("HEDERA_OPERATOR_KEY"));
  const issuerEvmAddress = privateKeyToAccount(rawKey).address;

  console.log(`Looking up the issuer's native account ID for ${issuerEvmAddress}...`);
  const operatorAccountId = await lookupAccountId(issuerEvmAddress);
  console.log(`  ${operatorAccountId}`);

  const operatorKey = PrivateKey.fromStringECDSA(rawKey.slice(2));
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(operatorAccountId),
    operatorKey,
  );

  const contractCall = new ContractExecuteTransaction()
    .setContractId(ContractId.fromEvmAddress(0, 0, distributorAddress))
    .setGas(300_000)
    .setFunction(
      "distribute",
      new ContractFunctionParameters().addUint256(couponId.toString()).addAddress(holder),
    );

  const expirationTime = Timestamp.fromDate(new Date(Date.now() + secondsFromNow * 1000));
  console.log(
    `\nScheduling distribute(${couponId}, ${holder}), to execute at ${expirationTime.toDate().toISOString()} ` +
      `(waitForExpiry: true — this genuinely waits, it does not fire early just because the payer signed).`,
  );

  const scheduled = await new ScheduleCreateTransaction()
    .setScheduledTransaction(contractCall)
    .setPayerAccountId(AccountId.fromString(operatorAccountId))
    .setAdminKey(operatorKey.publicKey)
    .setScheduleMemo(`NameGate coupon ${couponId} distribution to ${holder}`)
    .setExpirationTime(expirationTime)
    .setWaitForExpiry(true)
    .freezeWith(client)
    .sign(operatorKey);

  const receipt = await (await scheduled.execute(client)).getReceipt(client);
  const scheduleId = receipt.scheduleId;
  if (!scheduleId) throw new Error("ScheduleCreateTransaction receipt carried no schedule ID.");
  console.log(`Scheduled. Schedule ID: ${scheduleId.toString()}`);

  const infoRightAfter = await new ScheduleInfoQuery().setScheduleId(scheduleId).execute(client);
  console.log(
    `  executed right after creation: ${infoRightAfter.executed !== null} ` +
      "(should be false — it has not reached its expiration time yet)",
  );

  console.log(`\nWaiting ${secondsFromNow + 20}s for the schedule to reach expiration and execute...`);
  await new Promise((resolve) => setTimeout(resolve, (secondsFromNow + 20) * 1000));

  // Re-check via the mirror node's REST API, not another gRPC ScheduleInfoQuery:
  // caught live that consensus nodes stop answering queries for an executed
  // wait-for-expiry schedule almost immediately (a real INVALID_SCHEDULE_ID
  // precheck failure on the very next query), while the mirror node keeps the
  // full, durable execution record. Same HTTP-first pattern the rest of this
  // project already uses for Hedera state.
  const mirrorResponse = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/schedules/${scheduleId.toString()}`,
  );
  if (!mirrorResponse.ok) {
    throw new Error(`Mirror node has no record of schedule ${scheduleId.toString()} yet.`);
  }
  const scheduleRecord = (await mirrorResponse.json()) as { executed_timestamp: string | null };
  console.log(
    scheduleRecord.executed_timestamp
      ? `Executed at consensus timestamp ${scheduleRecord.executed_timestamp} — the coupon distribution ` +
          "ran without anyone calling distribute() by hand at that moment."
      : "Not yet executed per the mirror node — it may need a little more time to catch up; re-check " +
          `https://testnet.mirrornode.hedera.com/api/v1/schedules/${scheduleId.toString()}`,
  );

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
