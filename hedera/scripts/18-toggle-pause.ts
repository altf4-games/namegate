// Toggles the issuer's pause switch, live. Demo beat: pause, show a real
// transfer/issue revert, unpause, show it succeed again.
//
// Run:
//   npm run hedera:toggle-pause -- on
//   npm run hedera:toggle-pause -- off

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { confirmTransaction } from "../../shared/src/tx.js";

const artifactPath = fileURLToPath(
  new URL("../../artifacts/contracts/hedera/IssuerPauseSwitch.sol/IssuerPauseSwitch.json", import.meta.url),
);

async function main() {
  const flag = process.argv[2];
  if (flag !== "on" && flag !== "off") {
    throw new Error('Usage: npm run hedera:toggle-pause -- on|off');
  }
  const paused = flag === "on";

  const pauseSwitchAddress = process.env.PAUSE_SWITCH_ADDRESS as `0x${string}` | undefined;
  if (!pauseSwitchAddress) {
    throw new Error("Set PAUSE_SWITCH_ADDRESS (from 16-deploy-pause-switch.ts) in .env.");
  }

  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as { abi: unknown[] };
  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();

  console.log(`Setting the bond's pause switch to ${paused ? "PAUSED" : "unpaused"}...`);
  const { request } = await publicClient.simulateContract({
    address: pauseSwitchAddress,
    abi: artifact.abi,
    functionName: "setPaused",
    args: [paused],
    account: issuerAccount,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await confirmTransaction(publicClient, hash, "Toggling the pause switch");
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);

  const current = await publicClient.readContract({
    address: pauseSwitchAddress,
    abi: artifact.abi,
    functionName: "isPaused",
  });
  console.log(`isPaused() now reads: ${current}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
