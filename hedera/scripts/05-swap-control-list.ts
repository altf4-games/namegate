// Swaps the bond's compliance gate from the old owner-writable
// NameGateEnsControlList to the new ENSComplianceMirror — WITHOUT
// redeploying the bond.
//
// ATS combines every registered external control list with AND (see
// ExternalControlListManagementStorageWrapper.sol: any list returning false
// blocks the transfer). Adding the mirror alongside the old list would
// therefore require BOTH to independently authorize every investor, which is
// not what "replace the compliance source" means — so this removes the old
// one in the same run, never leaving both registered together.
//
// Run: npm run hedera:swap-control-list

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { externalControlListManagementAbi } from "../src/abi.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env — see .env.example.`);
  }
  return value;
}

async function isRegistered(bond: `0x${string}`, controlList: `0x${string}`) {
  return publicClient.readContract({
    address: bond,
    abi: externalControlListManagementAbi,
    functionName: "isExternalControlList",
    args: [controlList],
  });
}

async function main() {
  const bond = requireEnv("BOND_ADDRESS") as `0x${string}`;
  const oldControlList = requireEnv("ENS_CONTROL_LIST_ADDRESS") as `0x${string}`;
  const mirror = requireEnv("MIRROR_ADDRESS") as `0x${string}`;

  const account = getIssuerAccount();
  const walletClient = getWalletClient();

  console.log(`Bond:              ${bond}`);
  console.log(`Old control list:  ${oldControlList}`);
  console.log(`New mirror:        ${mirror}`);
  console.log();

  const [oldRegisteredBefore, mirrorRegisteredBefore] = await Promise.all([
    isRegistered(bond, oldControlList),
    isRegistered(bond, mirror),
  ]);
  console.log(`Before: old registered=${oldRegisteredBefore}, mirror registered=${mirrorRegisteredBefore}`);

  if (mirrorRegisteredBefore) {
    throw new Error("Mirror is already registered on this bond — nothing to do.");
  }

  console.log("\nAdding the mirror...");
  const addHash = await walletClient.writeContract({
    address: bond,
    abi: externalControlListManagementAbi,
    functionName: "addExternalControlList",
    args: [mirror],
    chain: publicClient.chain,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: addHash });

  if (oldRegisteredBefore) {
    console.log("Removing the old control list...");
    const removeHash = await walletClient.writeContract({
      address: bond,
      abi: externalControlListManagementAbi,
      functionName: "removeExternalControlList",
      args: [oldControlList],
      chain: publicClient.chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: removeHash });
  } else {
    console.log("Old control list was not registered — nothing to remove.");
  }

  // Read the bond's own state back rather than trusting either receipt. Both
  // ATS functions revert on a no-op (ListedControlList / UnlistedControlList)
  // rather than returning false, so a mined transaction is meaningful — but
  // "mined" still is not "the state I expect," which is the distinction that
  // has mattered every other time this project touched live state.
  const [oldRegisteredAfter, mirrorRegisteredAfter] = await Promise.all([
    isRegistered(bond, oldControlList),
    isRegistered(bond, mirror),
  ]);
  console.log(`\nAfter:  old registered=${oldRegisteredAfter}, mirror registered=${mirrorRegisteredAfter}`);

  if (!mirrorRegisteredAfter) {
    throw new Error("Mirror is still not registered after the swap. Something is wrong.");
  }
  if (oldRegisteredAfter) {
    throw new Error(
      "Old control list is STILL registered. With AND semantics, every " +
        "investor authorized by the mirror alone will now be blocked by the " +
        "stale old list. Do not use this bond until this is fixed.",
    );
  }

  console.log("\nSwap verified: the mirror is the bond's only compliance gate.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
