// Vercel serverless function: schedule a future coupon distribution via
// Hedera's native Schedule Service.
//
// The browser can't do this itself — ScheduleCreateTransaction needs the
// native Hiero SDK's gRPC connection, which doesn't run client-side. This
// endpoint holds the issuer's operator key (Vercel env var, never shipped
// to the client) and does the scheduling server-side, the same flow as
// hedera/scripts/15-schedule-coupon-distribution.ts.
//
// Guards: the wrapped call is CouponDistributor.distribute(), which is
// permissionless and can only ever pay the real holder the real amount the
// bond itself says is owed — there is no address for a caller to redirect
// funds toward. Inputs are still validated and the schedule window is
// capped so the endpoint can't be used to burn the operator's HBAR on a
// flood of long-lived schedules.
//
// Required Vercel env vars: HEDERA_OPERATOR_KEY, COUPON_DISTRIBUTOR_ADDRESS.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  AccountId,
  Client,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  PrivateKey,
  ScheduleCreateTransaction,
  Timestamp,
} from "@hiero-ledger/sdk";
import { privateKeyToAccount } from "viem/accounts";

const MIN_SECONDS = 30;
const MAX_SECONDS = 600;

function normalize(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

async function lookupAccountId(evmAddress: string): Promise<string> {
  const response = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`,
  );
  if (!response.ok) throw new Error(`Mirror node lookup failed: ${response.status}`);
  const json = (await response.json()) as { account?: string };
  if (!json.account) throw new Error(`Mirror node has no record for ${evmAddress}`);
  return json.account;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawKey = process.env.HEDERA_OPERATOR_KEY;
  const distributorAddress = process.env.COUPON_DISTRIBUTOR_ADDRESS;
  if (!rawKey || !distributorAddress) {
    return res.status(500).json({
      error: "Server is missing HEDERA_OPERATOR_KEY or COUPON_DISTRIBUTOR_ADDRESS.",
    });
  }

  const body = (req.body ?? {}) as { holder?: string; couponId?: number; secondsFromNow?: number };
  const holder = typeof body.holder === "string" ? body.holder.trim() : "";
  const couponId = Number(body.couponId);
  const secondsFromNow = Number(body.secondsFromNow);

  if (!/^0x[0-9a-fA-F]{40}$/.test(holder)) {
    return res.status(400).json({ error: "holder must be a 0x-prefixed 20-byte address" });
  }
  if (!Number.isInteger(couponId) || couponId <= 0) {
    return res.status(400).json({ error: "couponId must be a positive integer" });
  }
  if (!Number.isFinite(secondsFromNow) || secondsFromNow < MIN_SECONDS || secondsFromNow > MAX_SECONDS) {
    return res.status(400).json({ error: `secondsFromNow must be between ${MIN_SECONDS} and ${MAX_SECONDS}` });
  }

  let client: Client | null = null;
  try {
    const issuerEvmAddress = privateKeyToAccount(normalize(rawKey)).address;
    const operatorAccountId = await lookupAccountId(issuerEvmAddress);
    const operatorKey = PrivateKey.fromStringECDSA(normalize(rawKey).slice(2));
    client = Client.forTestnet().setOperator(AccountId.fromString(operatorAccountId), operatorKey);

    const contractCall = new ContractExecuteTransaction()
      .setContractId(ContractId.fromEvmAddress(0, 0, distributorAddress))
      .setGas(300_000)
      .setFunction(
        "distribute",
        new ContractFunctionParameters().addUint256(couponId).addAddress(holder),
      );

    const expirationTime = Timestamp.fromDate(new Date(Date.now() + secondsFromNow * 1000));

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
    if (!scheduleId) throw new Error("ScheduleCreateTransaction receipt carried no schedule ID");

    return res.status(200).json({
      scheduleId: scheduleId.toString(),
      expiresAt: expirationTime.toDate().toISOString(),
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    client?.close();
  }
}
