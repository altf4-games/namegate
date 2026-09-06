// Deploys CouponDistributor to Hedera testnet.
//
// Run: npm run hedera:deploy-distributor

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";

const artifactPath = fileURLToPath(
  new URL(
    "../../artifacts/contracts/hedera/CouponDistributor.sol/CouponDistributor.json",
    import.meta.url,
  ),
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

async function main() {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
    abi: unknown[];
    bytecode: `0x${string}`;
  };

  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const mirror = requireEnv("MIRROR_ADDRESS") as `0x${string}`;
  // TINYBAR (not wei — see CouponDistributor.sol's header) paid per whole
  // unit of the bond's declared currency: 1_000_000 tinybar = 0.01 HBAR.
  // Found live: Hedera's EVM represents HBAR in 8-decimal tinybar
  // internally (address(this).balance, .call{value:}), which is 10 decimal
  // places smaller than the 18-decimal "weibar" eth_getBalance reports
  // externally over the JSON-RPC relay. An earlier value here (1e16) was
  // calibrated for the wrong scale entirely and made every live
  // distribute() call revert with InsufficientContractBalance against a
  // contract that had genuinely just been funded — see
  // hedera/test/live/couponLive.test.ts, which locks in the correct
  // 8-decimal convention against the real chain going forward.
  const payoutScale = BigInt(process.env.PAYOUT_SCALE_TINYBAR ?? "1000000"); // 1e6 tinybar = 0.01 HBAR

  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  console.log(`Deploying CouponDistributor as ${account.address}`);
  console.log(`  bond:        ${bond}`);
  console.log(`  controlList: ${mirror} (the mirror — same gate the bond's transfers use)`);
  console.log(`  payoutScale: ${payoutScale} tinybar per currency unit`);
  console.log();

  const hash = await walletClient.deployContract({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode,
    account,
    chain: publicClient.chain,
    args: [bond, mirror, payoutScale],
  });

  console.log(`Deploy tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Deployment reverted. Receipt status: ${receipt.status}`);
  }
  if (!receipt.contractAddress) {
    throw new Error("Deployment succeeded but no contract address in the receipt.");
  }

  const [deployedBond, deployedControlList, deployedScale] = await Promise.all([
    publicClient.readContract({
      address: receipt.contractAddress,
      abi: artifact.abi as never,
      functionName: "bond",
    }),
    publicClient.readContract({
      address: receipt.contractAddress,
      abi: artifact.abi as never,
      functionName: "controlList",
    }),
    publicClient.readContract({
      address: receipt.contractAddress,
      abi: artifact.abi as never,
      functionName: "payoutScale",
    }),
  ]);

  if ((deployedBond as string).toLowerCase() !== bond.toLowerCase()) {
    throw new Error("Deployed distributor's bond does not match BOND_ADDRESS.");
  }
  if ((deployedControlList as string).toLowerCase() !== mirror.toLowerCase()) {
    throw new Error("Deployed distributor's controlList does not match MIRROR_ADDRESS.");
  }
  if (deployedScale !== payoutScale) {
    throw new Error("Deployed distributor's payoutScale does not match what was passed.");
  }

  console.log();
  console.log(`Deployed at: ${receipt.contractAddress}`);
  console.log(`Gas used:    ${receipt.gasUsed}`);
  console.log("Verified: bond, controlList, and payoutScale all read back correctly.");
  console.log();
  console.log("Add to .env:");
  console.log(`COUPON_DISTRIBUTOR_ADDRESS=${receipt.contractAddress}`);
  console.log();
  console.log("Next: fund it (npm run hedera:fund-distributor) then npm run hedera:distribute");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
