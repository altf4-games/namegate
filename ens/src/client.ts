import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalizePrivateKey } from "../../shared/src/normalizePrivateKey.js";

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

// Read-only — only needs an RPC URL. Safe for scripts that never sign a tx.
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(requireEnv("SEPOLIA_RPC_URL")),
});

// Lazy, memoized signer — so a read-only script (04-read-compliance.ts)
// never demands ISSUER_PRIVATE_KEY just for importing this module. Scripts
// that write should call getWalletClient() / getIssuerAccount() themselves.
let cached: {
  walletClient: ReturnType<typeof createWalletClient>;
  issuerAccount: ReturnType<typeof privateKeyToAccount>;
} | undefined;

function getSigner() {
  if (!cached) {
    const issuerAccount = privateKeyToAccount(
      normalizePrivateKey(requireEnv("ISSUER_PRIVATE_KEY"), "ISSUER_PRIVATE_KEY"),
    );
    const walletClient = createWalletClient({
      account: issuerAccount,
      chain: sepolia,
      transport: http(requireEnv("SEPOLIA_RPC_URL")),
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
