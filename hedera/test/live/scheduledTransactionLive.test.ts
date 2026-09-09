// LIVE regression test for the scheduling mechanism 15-schedule-coupon-distribution.ts
// relies on: ScheduleCreateTransaction with waitForExpiry: true genuinely
// waits for its expiration time rather than executing early, and its
// eventual execution is durably observable via the mirror node.
//
// Uses a trivial, always-repeatable action (a 1-tinybar HBAR self-transfer)
// rather than re-running the real coupon distribution each time, which
// would need a fresh unpaid entitlement (a real recordDate wait plus a
// funded, never-paid holder) on every run. The mechanism under test — does
// a wait-for-expiry schedule actually wait, and does it actually execute —
// is identical either way.
//
// Confirmed live, the hard way, before this test was written: a follow-up
// ScheduleInfoQuery over gRPC against an already-executed wait-for-expiry
// schedule fails with a real INVALID_SCHEDULE_ID precheck error almost
// immediately — the consensus nodes do not keep it around. The mirror
// node's REST record is the durable source of truth, so that's what this
// test (and the real script) checks post-execution, not another gRPC query.
//
// Requires HEDERA_OPERATOR_KEY in .env, and gRPC egress to Hedera testnet's
// consensus nodes on ports 50211/50212 — some networks block this even
// though the JSON-RPC relay (plain HTTPS) the rest of this project uses
// works fine. Confirmed live to fail identically from two separate networks
// that block it, and to work from a mobile hotspot.
//
// Run: npm run test:live:schedule

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleInfoQuery,
  Timestamp,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { privateKeyToAccount } from "viem/accounts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}

function normalize(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

describe("Wait-for-expiry scheduled transaction (live)", () => {
  let client: Client;
  let operatorAccountId: string;
  let operatorKey: PrivateKey;
  let recipientAccountId: string;

  async function lookupAccountId(evmAddress: string): Promise<string> {
    const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`);
    if (!response.ok) throw new Error(`Mirror node lookup for ${evmAddress} failed: ${response.status}`);
    const json = (await response.json()) as { account?: string };
    if (!json.account) throw new Error(`Mirror node has no account record for ${evmAddress} yet.`);
    return json.account;
  }

  before(async () => {
    const rawKey = normalize(requireEnv("HEDERA_OPERATOR_KEY"));
    operatorAccountId = await lookupAccountId(privateKeyToAccount(rawKey).address);
    recipientAccountId = await lookupAccountId(requireEnv("INVESTOR_A_ADDRESS"));
    operatorKey = PrivateKey.fromStringECDSA(rawKey.slice(2));
    client = Client.forTestnet().setOperator(AccountId.fromString(operatorAccountId), operatorKey);
  });

  after(() => {
    client.close();
  });

  test("a wait-for-expiry schedule does not execute before its expiration, and does after", async () => {
    // A 1-tinybar transfer to the operator's own investorA test account —
    // negligible value, real transfer. Two entries for the SAME account
    // (a same-account self-transfer) risks the SDK or network treating it
    // as a zero-sum no-op or a duplicate-account error, so this uses a
    // second, real, already-known account instead.
    const selfTransfer = new TransferTransaction()
      .addHbarTransfer(operatorAccountId, Hbar.fromTinybars(-1))
      .addHbarTransfer(recipientAccountId, Hbar.fromTinybars(1));

    const expirationTime = Timestamp.fromDate(new Date(Date.now() + 30_000));
    const scheduled = await new ScheduleCreateTransaction()
      .setScheduledTransaction(selfTransfer)
      .setPayerAccountId(AccountId.fromString(operatorAccountId))
      .setAdminKey(operatorKey.publicKey)
      .setScheduleMemo("namegate live test: wait-for-expiry")
      .setExpirationTime(expirationTime)
      .setWaitForExpiry(true)
      .freezeWith(client)
      .sign(operatorKey);

    const receipt = await (await scheduled.execute(client)).getReceipt(client);
    const scheduleId = receipt.scheduleId;
    assert.ok(scheduleId, "ScheduleCreateTransaction receipt should carry a schedule ID");

    const infoRightAfter = await new ScheduleInfoQuery().setScheduleId(scheduleId!).execute(client);
    assert.equal(
      infoRightAfter.executed,
      null,
      "a wait-for-expiry schedule must not execute before its expiration time",
    );

    await new Promise((resolve) => setTimeout(resolve, 45_000));

    const mirrorResponse = await fetch(
      `https://testnet.mirrornode.hedera.com/api/v1/schedules/${scheduleId!.toString()}`,
    );
    assert.ok(mirrorResponse.ok, "mirror node should have a record of the schedule by now");
    const record = (await mirrorResponse.json()) as { executed_timestamp: string | null };
    assert.ok(
      record.executed_timestamp,
      "the schedule should have executed once its expiration time passed",
    );
  });
});
