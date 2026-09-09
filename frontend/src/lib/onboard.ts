// Onboards a brand-new investor, live, from whichever wallet is connected —
// the same three calls ens/scripts/02-register-investor.ts,
// 03-set-compliance.ts, and hedera/scripts/09-issue-tokens.ts make, just
// driven by a browser wallet instead of the issuer's local key. Each call is
// still gated exactly the way it always was (ROLE_REGISTRAR, the resolver's
// text-write authorization, ROLE_ISSUER) — connecting a wallet that doesn't
// hold those roles gets a real, honest revert, not a bypass.
//
// This exists because a demo that can only ever show the same two
// pre-loaded investors reads as a fixed script, not a working product. A
// freshly onboarded investor also always has a real, unpaid coupon
// entitlement under the existing coupon (paid[couponId][holder] has never
// been set for them), so distribute() has something genuine to do on camera
// without needing a second coupon.

import { createWalletClient, custom, encodeFunctionData } from "viem";
import { sepolia, hederaTestnet } from "viem/chains";
import { namehash } from "viem/ens";
import { sepoliaClient, hederaClient } from "./chains";
import { addresses, bondAbi } from "./contracts";
import { env } from "./env";
import { assertUsableLabel } from "../../../ens/src/label.js";
import { userRegistryAbi, permissionedResolverAbi, INVESTOR_ROLE_BITMAP } from "../../../ens/src/abi.js";
import { PARENT_NAME, COMPLIANCE_KEYS, RESOLVER_ROLES } from "../../../ens/src/constants.js";
import { dateToUnixSeconds, assertContractParseableDate } from "../../../ens/src/compliance.js";
import { dnsEncodeName } from "../../../ens/src/dnsEncode.js";
import { ensureChain, type MinimalEip1193Provider } from "./actions";

export type OnboardInput = {
  label: string;
  investorAddress: `0x${string}`;
  kyc: string;
  jurisdiction: string;
  accreditationExpiry: string; // YYYY-MM-DD
  lockupUntil: string; // YYYY-MM-DD, or "" for no lockup
};

function walletClientFor(provider: MinimalEip1193Provider, chain: typeof sepolia | typeof hederaTestnet) {
  return createWalletClient({ chain, transport: custom(provider) });
}

/** Step 1: mint the ENS subname to the investor, non-transferable, resolver fixed to the issuer's. */
export async function registerInvestor(
  provider: MinimalEip1193Provider,
  account: `0x${string}`,
  input: Pick<OnboardInput, "label" | "investorAddress" | "accreditationExpiry">,
): Promise<{ txHash: `0x${string}` }> {
  assertUsableLabel(input.label);
  const expiry = dateToUnixSeconds(input.accreditationExpiry);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiry <= now) {
    throw new Error(`${input.accreditationExpiry} is not in the future — the registry rejects a past expiry.`);
  }

  await ensureChain(provider, sepolia.id);
  const walletClient = walletClientFor(provider, sepolia);
  const { request } = await sepoliaClient.simulateContract({
    address: env.issuerUserRegistryAddress,
    abi: userRegistryAbi,
    functionName: "register",
    args: [
      input.label,
      input.investorAddress,
      "0x0000000000000000000000000000000000000000",
      env.issuerResolverAddress,
      INVESTOR_ROLE_BITMAP,
      expiry,
    ],
    account,
  });
  const txHash = await walletClient.writeContract(request);
  const receipt = await sepoliaClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`register() reverted. Status: ${receipt.status}`);

  // The issuer's compliance.* write access is granted per-investor, not
  // globally (see ens/scripts/14-migrate-issuer-to-per-name-roles.ts) — a
  // brand-new investor has no writer authorized yet, so step 2 would revert
  // without this.
  const { request: roleRequest } = await sepoliaClient.simulateContract({
    address: env.issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "authorizeNameRoles",
    args: [dnsEncodeName(`${input.label}.${PARENT_NAME}`), RESOLVER_ROLES.SET_TEXT, account, true],
    account,
  });
  const roleTxHash = await walletClient.writeContract(roleRequest);
  const roleReceipt = await sepoliaClient.waitForTransactionReceipt({ hash: roleTxHash });
  if (roleReceipt.status !== "success") {
    throw new Error(`authorizeNameRoles() reverted. Status: ${roleReceipt.status}`);
  }
  return { txHash };
}

/** Step 2: write the compliance text records, batched into one multicall. */
export async function setComplianceRecords(
  provider: MinimalEip1193Provider,
  account: `0x${string}`,
  input: OnboardInput,
): Promise<{ txHash: `0x${string}` }> {
  const node = namehash(`${input.label}.${PARENT_NAME}`);

  const updates: Array<{ key: string; value: string }> = [
    { key: COMPLIANCE_KEYS.kyc, value: input.kyc },
    { key: COMPLIANCE_KEYS.jurisdiction, value: input.jurisdiction },
    { key: COMPLIANCE_KEYS.accreditationExpiry, value: input.accreditationExpiry },
  ];
  if (input.lockupUntil) updates.push({ key: COMPLIANCE_KEYS.lockupUntil, value: input.lockupUntil });
  for (const u of updates) {
    if (u.key === COMPLIANCE_KEYS.accreditationExpiry || u.key === COMPLIANCE_KEYS.lockupUntil) {
      assertContractParseableDate(u.key, u.value);
    }
  }

  const calls = updates.map(({ key, value }) =>
    encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [node, key, value] }),
  );

  await ensureChain(provider, sepolia.id);
  const walletClient = walletClientFor(provider, sepolia);
  const { request } = await sepoliaClient.simulateContract({
    address: env.issuerResolverAddress,
    abi: permissionedResolverAbi,
    functionName: "multicall",
    args: [calls],
    account,
  });
  const txHash = await walletClient.writeContract(request);
  const receipt = await sepoliaClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`multicall() reverted. Status: ${receipt.status}`);
  return { txHash };
}

/** Step 3: issue bond tokens — requires the holder to already be authorized on the Hedera mirror (publish first). */
export async function issueTokens(
  provider: MinimalEip1193Provider,
  account: `0x${string}`,
  holder: `0x${string}`,
  wholeUnits: number,
): Promise<{ txHash: `0x${string}` }> {
  if (!Number.isFinite(wholeUnits) || wholeUnits <= 0) {
    throw new Error(`wholeUnits must be a positive number, got ${wholeUnits}`);
  }
  const decimals = (await hederaClient.readContract({
    address: addresses.bond,
    abi: bondAbi,
    functionName: "decimals",
  })) as number;
  const value = BigInt(wholeUnits) * 10n ** BigInt(decimals);

  await ensureChain(provider, hederaTestnet.id);
  const walletClient = walletClientFor(provider, hederaTestnet);
  const { request } = await hederaClient.simulateContract({
    address: addresses.bond,
    abi: bondAbi,
    functionName: "issue",
    args: [holder, value, "0x"],
    account,
  });
  const txHash = await walletClient.writeContract(request);
  const receipt = await hederaClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`issue() reverted. Status: ${receipt.status}`);
  return { txHash };
}
