import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

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

function normalizePrivateKey(raw: string): `0x${string}` {
  // MetaMask's "Export private key" copies the hex without a 0x prefix —
  // viem/noble require it. Accept either form.
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      "ISSUER_PRIVATE_KEY doesn't look like a 32-byte hex key (64 hex chars, " +
        "with or without a leading 0x). Check for stray whitespace or quotes.",
    );
  }
  return withPrefix as `0x${string}`;
}

function getSigner() {
  if (!cached) {
    const issuerAccount = privateKeyToAccount(
      normalizePrivateKey(requireEnv("ISSUER_PRIVATE_KEY")),
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
