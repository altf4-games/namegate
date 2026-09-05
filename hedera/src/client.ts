import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in — never paste ` +
        `a private key into chat or a committed file.`,
    );
  }
  return v;
}

export const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api"] },
  },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: hederaTestnet,
  transport: http(),
});

let cached:
  | {
      walletClient: ReturnType<typeof createWalletClient>;
      issuerAccount: ReturnType<typeof privateKeyToAccount>;
    }
  | undefined;

function getSigner() {
  if (!cached) {
    // Must be the account's ECDSA hex key, not Hedera Portal's DER-encoded
    // default export — see hardhat.config.cjs for the same caveat.
    const issuerAccount = privateKeyToAccount(
      requireEnv("HEDERA_OPERATOR_KEY") as `0x${string}`,
    );
    const walletClient = createWalletClient({
      account: issuerAccount,
      chain: hederaTestnet,
      transport: http(),
    });
    cached = { walletClient, issuerAccount };
  }
  return cached;
}

export function getWalletClient() {
  return getSigner().walletClient;
}

export function getIssuerAccount() {
  return getSigner().issuerAccount;
}
