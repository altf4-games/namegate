require("@nomicfoundation/hardhat-toolbox");

// Hedera testnet, reached through the public Hashio JSON-RPC relay.
// Chain ID 296. If Hashio throttles under load, switch to the thirdweb
// mirror: https://296.rpc.thirdweb.com (see docs/BUILD-PLAN.md, Day 1 Gate B).
const HEDERA_RPC_URL = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";

// Networks are only reachable when their RPC URL is set, but `hardhat compile`
// and `hardhat test` must keep working without any .env at all — so this
// returns a placeholder that fails loudly only if something actually tries to
// connect with it.
function requireUrl(name) {
  return process.env[name] ?? `http://unset-${name.toLowerCase()}.invalid`;
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  // Source verification. Deployment happens through the viem scripts, but
  // `hardhat verify` is how the Sepolia beacon's source gets published, and
  // the Hedera contracts go on HashScan. Wiring this up now rather than on
  // submission day, when a first-time verification failure would have no
  // room left to debug.
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
  sourcify: {
    // HashScan reads verification status from the public Sourcify service —
    // confirmed live: GET https://sourcify.dev/server/chains lists chain 296
    // (Hedera Testnet) and 295 (mainnet) as supported=true. The
    // "server-verify.hashscan.io" hostname some docs mention is a Cloudflare
    // redirect back to sourcify.dev/server, not a separate instance, so
    // pointing here directly is the same destination with one less hop.
    enabled: true,
    apiUrl: "https://sourcify.dev/server",
    browserUrl: "https://repo.sourcify.dev",
  },
  networks: {
    sepolia: {
      // No fallback: an empty URL produces a confusing connection error at
      // call time instead of naming the missing variable.
      url: requireUrl("SEPOLIA_RPC_URL"),
      chainId: 11155111,
    },
    hederaTestnet: {
      url: HEDERA_RPC_URL,
      chainId: 296,
      // Must be the account's ECDSA hex private key (0x...), not the DER-
      // encoded key Hedera Portal shows by default — Hashio's EVM JSON-RPC
      // relay needs a raw secp256k1 key. Portal account must have an EVM
      // alias / be ECDSA-based; a plain ED25519 Hedera account won't work
      // here at all.
      accounts: process.env.HEDERA_OPERATOR_KEY ? [process.env.HEDERA_OPERATOR_KEY] : [],
    },
  },
};
