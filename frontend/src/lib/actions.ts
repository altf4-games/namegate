import { createWalletClient, custom, decodeEventLog } from "viem";
import { sepolia, hederaTestnet } from "viem/chains";
import { sepoliaClient, hederaClient } from "./chains";
import { addresses, beaconAbi, distributorAbi } from "./contracts";
import { env } from "./env";

// Privy's wallet objects hand back an EIP-1193 provider typed against their
// own SDK, which structurally differs from viem's EIP1193Provider only in
// how strictly the `on`/`removeListener` event overloads are typed — both
// describe the same real, wallet-standard interface at runtime. Accepting
// the minimal shape actually used (`request`) here, instead of importing
// viem's stricter type, avoids a type-only mismatch between two packages
// describing the same standard.
export type MinimalEip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const FEE_BUFFER_BPS = 2000n; // 20% over the quote, matching ens/scripts/11-beacon-publish.ts

/**
 * Ensures the injected/embedded wallet is on the chain a transaction is
 * about to go to, requesting a switch (or adding the chain, for Hedera
 * testnet, which most wallets don't ship pre-configured) if it isn't.
 * viem's walletClient.writeContract does not do this for you — sending a
 * Hedera transaction while the wallet is still pointed at Sepolia fails
 * with a confusing "wrong chain" error deep in the RPC response otherwise.
 */
async function ensureChain(provider: MinimalEip1193Provider, chainId: number) {
  const currentHex = (await provider.request({ method: "eth_chainId" })) as string;
  if (parseInt(currentHex, 16) === chainId) return;

  const hex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }],
    });
  } catch {
    if (chainId !== hederaTestnet.id) throw new Error(`Switch your wallet to chain ${chainId} and try again.`);
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: "Hedera Testnet",
          nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
          rpcUrls: [env.hederaRpcUrl],
          blockExplorerUrls: ["https://hashscan.io/testnet"],
        },
      ],
    });
  }
}

/**
 * Calls beacon.publish(label) from whichever wallet is connected — no
 * relayer, no issuer key, exactly the "call it yourself" claim the pitch
 * makes. Returns the real CCIP messageId decoded from the CompliancePublished
 * event, not a value invented client-side.
 */
export async function publishCompliance(
  provider: MinimalEip1193Provider,
  account: `0x${string}`,
  label: string,
): Promise<{ txHash: `0x${string}`; messageId: `0x${string}` }> {
  await ensureChain(provider, sepolia.id);
  const walletClient = createWalletClient({ chain: sepolia, transport: custom(provider) });

  const fee = (await sepoliaClient.readContract({
    address: addresses.beacon,
    abi: beaconAbi,
    functionName: "quote",
    args: [label],
  })) as bigint;
  const value = fee + (fee * FEE_BUFFER_BPS) / 10_000n;

  const { request } = await sepoliaClient.simulateContract({
    address: addresses.beacon,
    abi: beaconAbi,
    functionName: "publish",
    args: [label],
    account,
    value,
  });

  const txHash = await walletClient.writeContract(request);
  const receipt = await sepoliaClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`publish() reverted. Receipt status: ${receipt.status}`);
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== addresses.beacon.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: beaconAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "CompliancePublished") {
        const args = decoded.args as unknown as { messageId: `0x${string}` };
        return { txHash, messageId: args.messageId };
      }
    } catch {
      // Not our event; ignore.
    }
  }
  throw new Error("publish() succeeded but no CompliancePublished event was found in the receipt.");
}

/**
 * Calls CouponDistributor.distribute(couponId, holder) from whichever wallet
 * is connected — permissionless, same as publish. Anyone can trigger a
 * payout to an eligible holder; nobody but that holder receives the funds.
 */
export async function distributeCoupon(
  provider: MinimalEip1193Provider,
  account: `0x${string}`,
  holder: `0x${string}`,
): Promise<{ txHash: `0x${string}`; amountTinybar: bigint }> {
  await ensureChain(provider, hederaTestnet.id);
  const walletClient = createWalletClient({ chain: hederaTestnet, transport: custom(provider) });

  const { request } = await hederaClient.simulateContract({
    address: addresses.distributor,
    abi: distributorAbi,
    functionName: "distribute",
    args: [env.couponId, holder],
    account,
  });

  const txHash = await walletClient.writeContract(request);
  const receipt = await hederaClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`distribute() reverted. Receipt status: ${receipt.status}`);
  }

  const amountTinybar = (await hederaClient.readContract({
    address: addresses.distributor,
    abi: distributorAbi,
    functionName: "previewAmount",
    args: [env.couponId, holder],
  })) as bigint;

  return { txHash, amountTinybar };
}
