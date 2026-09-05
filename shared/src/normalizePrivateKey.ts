// Pulled out of client.ts so it can be unit tested without needing
// SEPOLIA_RPC_URL / ISSUER_PRIVATE_KEY set or a network connection —
// importing client.ts directly throws immediately if those env vars are
// missing, since it builds a public client at module load time.

/**
 * MetaMask's "Export Private Key" copies the hex without a leading 0x —
 * viem/noble reject that outright with an unhelpful stack trace. Accept
 * either form and validate the shape explicitly instead.
 */
export function normalizePrivateKey(raw: string, envVarName: string): `0x${string}` {
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      `${envVarName} doesn't look like a 32-byte hex key (64 hex chars, ` +
        `with or without a leading 0x). Check for stray whitespace or quotes.`,
    );
  }
  return withPrefix as `0x${string}`;
}
