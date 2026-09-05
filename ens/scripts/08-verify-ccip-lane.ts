// Verifies the Sepolia -> Hedera testnet CCIP lane is live, against the
// chain rather than against documentation. The beacon is useless if this
// lane is down or the selector is wrong, and a wrong selector fails at
// ccipSend time with an UnsupportedDestinationChain revert rather than at
// deploy time — so check it up front, and again before demoing.
//
// Run: npm run ens:verify-ccip

import { publicClient } from "../src/client.js";
import {
  CCIP_SEPOLIA_ROUTER,
  CCIP_HEDERA_TESTNET_SELECTOR,
  routerAbi,
} from "../src/ccip.js";

async function main() {
  console.log("CCIP router (Sepolia):", CCIP_SEPOLIA_ROUTER);
  console.log("Destination selector (Hedera testnet):", CCIP_HEDERA_TESTNET_SELECTOR.toString());
  console.log();

  const code = await publicClient.getCode({ address: CCIP_SEPOLIA_ROUTER });
  if (!code || code === "0x") {
    throw new Error(
      `No contract deployed at ${CCIP_SEPOLIA_ROUTER} on Sepolia. The router ` +
        "address is wrong or you are pointed at the wrong network.",
    );
  }
  console.log(`Router has bytecode (${(code.length - 2) / 2} bytes).`);

  const supported = await publicClient.readContract({
    address: CCIP_SEPOLIA_ROUTER,
    abi: routerAbi,
    functionName: "isChainSupported",
    args: [CCIP_HEDERA_TESTNET_SELECTOR],
  });

  if (!supported) {
    throw new Error(
      "Router reports the Hedera testnet selector is NOT supported. Either " +
        "the lane was retired or the selector is wrong — re-check the " +
        "Chainlink CCIP directory before continuing.",
    );
  }

  console.log("Router reports the Hedera testnet lane is supported.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
