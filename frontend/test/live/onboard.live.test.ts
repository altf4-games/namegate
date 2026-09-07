// Runs the actual onboarding write path against the real deployed contracts
// on Sepolia — the same functions the OnboardInvestor UI component calls,
// signed here by the issuer's real key instead of a browser wallet (there's
// no way to click through Privy's modal headlessly), via a minimal
// EIP-1193-shaped shim wrapping a real viem wallet client. A fresh label is
// generated every run so this test is safe to re-run — each run registers
// a genuinely new, real ENS subname.
//
// Requires ISSUER_PRIVATE_KEY (root .env) and the frontend's .env.local.
// Run from repo root: npm run frontend:test:live:onboard

import { describe, it, expect } from "vitest";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { registerInvestor, setComplianceRecords } from "../../src/lib/onboard";
import { readInvestor } from "../../src/lib/read";
import { env } from "../../src/lib/env";
import type { MinimalEip1193Provider } from "../../src/lib/actions";

function normalizeKey(raw: string): `0x${string}` {
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error("ISSUER_PRIVATE_KEY doesn't look like a 32-byte hex key.");
  }
  return withPrefix as `0x${string}`;
}

function issuerAsEip1193(): { provider: MinimalEip1193Provider; account: `0x${string}` } {
  const key = process.env.ISSUER_PRIVATE_KEY;
  if (!key) throw new Error("Missing ISSUER_PRIVATE_KEY — this test signs with the real issuer key.");
  const account = privateKeyToAccount(normalizeKey(key));
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(env.sepoliaRpcUrl) });
  const provider: MinimalEip1193Provider = {
    request: async ({ method, params }) => {
      if (method === "eth_sendTransaction") {
        const tx = (params as unknown[])[0] as Record<string, unknown>;
        return walletClient.sendTransaction({ ...tx, account, chain: sepolia } as never);
      }
      if (method === "eth_chainId") return `0x${sepolia.id.toString(16)}`;
      throw new Error(`unsupported method in test shim: ${method}`);
    },
  };
  return { provider, account: account.address };
}

describe("onboarding write path (live)", () => {
  it("registers a brand-new investor and sets real compliance records on Sepolia", async () => {
    const { provider, account } = issuerAsEip1193();
    const label = `investortest${Date.now()}`;
    const investorAddress = "0x000000000000000000000000000000000000dEaD" as const;
    const accreditationExpiry = "2027-09-05";

    const reg = await registerInvestor(provider, account, { label, investorAddress, accreditationExpiry });
    expect(reg.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const comp = await setComplianceRecords(provider, account, {
      label,
      investorAddress,
      kyc: "verified",
      jurisdiction: "US",
      accreditationExpiry,
      lockupUntil: "",
    });
    expect(comp.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const view = await readInvestor(label, investorAddress);
    expect(view.record.authorized).toBe(true);
    expect(view.record.kyc).toBe("verified");
    expect(view.description).toMatch(/^ELIGIBLE/);
  }, 60_000);
});
