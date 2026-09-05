// Chainlink CCIP endpoints for the Sepolia -> Hedera testnet lane.
//
// Source: Chainlink CCIP directory (v1.6.0). These are verified against live
// chain state by ens/scripts/08-verify-ccip-lane.ts rather than trusted from
// documentation — run it before relying on them, and again before the demo.
//
// There is no CCIP prize at this event, so this dependency consumes no
// sponsor slot. The trust placed in CCIP is delivery and ordering only: the
// beacon reads the ENS record itself, on-chain, so CCIP never asserts what a
// record says.

export const CCIP_SEPOLIA_ROUTER =
  "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59" as const;

export const CCIP_HEDERA_TESTNET_ROUTER =
  "0x802C5F84eAD128Ff36fD6a3f8a418e339f467Ce4" as const;

// uint64 chain selector, not a chain ID. Hedera testnet's EVM chain ID is 296.
export const CCIP_HEDERA_TESTNET_SELECTOR = 222782988166878823n;

export const routerAbi = [
  {
    type: "function",
    name: "isChainSupported",
    stateMutability: "view",
    inputs: [{ name: "destChainSelector", type: "uint64" }],
    outputs: [{ name: "supported", type: "bool" }],
  },
] as const;
