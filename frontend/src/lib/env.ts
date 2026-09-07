// Reads Vite's import.meta.env and fails loudly, at load time, if something
// the dashboard needs to show real data is missing — the same
// "requireEnv"-style convention the backend scripts use, so a misconfigured
// deploy shows an explicit error screen instead of silently rendering blank
// cards that look like a bug in the app rather than a missing address.

function requireEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

export const env = {
  sepoliaRpcUrl: requireEnv("VITE_SEPOLIA_RPC_URL"),
  hederaRpcUrl: requireEnv("VITE_HEDERA_RPC_URL"),

  beaconAddress: requireEnv("VITE_BEACON_ADDRESS") as `0x${string}`,
  mirrorAddress: requireEnv("VITE_MIRROR_ADDRESS") as `0x${string}`,
  bondAddress: requireEnv("VITE_BOND_ADDRESS") as `0x${string}`,
  distributorAddress: requireEnv("VITE_COUPON_DISTRIBUTOR_ADDRESS") as `0x${string}`,
  couponId: BigInt(requireEnv("VITE_COUPON_ID")),

  investorALabel: requireEnv("VITE_INVESTOR_A_LABEL"),
  investorAAddress: requireEnv("VITE_INVESTOR_A_ADDRESS") as `0x${string}`,
  investorBLabel: requireEnv("VITE_INVESTOR_B_LABEL"),
  investorBAddress: requireEnv("VITE_INVESTOR_B_ADDRESS") as `0x${string}`,

  issuerResolverAddress: requireEnv("VITE_ISSUER_RESOLVER_ADDRESS") as `0x${string}`,
  issuerUserRegistryAddress: requireEnv("VITE_ISSUER_USER_REGISTRY_ADDRESS") as `0x${string}`,

  // Empty, not missing, is tolerated here: wallet connect and the Privy
  // policy control are meant to degrade to "not configured yet" rather
  // than blocking the whole read-only dashboard from rendering.
  privyAppId: (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ?? "",
};
