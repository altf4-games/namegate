require("@nomicfoundation/hardhat-toolbox");

// Hedera testnet, reached through the public Hashio JSON-RPC relay.
// Chain ID 296. If Hashio throttles under load, switch to the thirdweb
// mirror: https://296.rpc.thirdweb.com (see docs/BUILD-PLAN.md, Day 1 Gate B).
const HEDERA_RPC_URL = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";

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
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "",
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
