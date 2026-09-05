// PREREQUISITE: you must have already registered `namegate.eth` on ENSv2
// Sepolia yourself (via ens-cli or https://explorer.ens.dev/) before running
// this. This script does NOT register the parent 2LD — only the app-side
// infrastructure under it:
//
//   1. Deploy a PermissionedResolver proxy that YOU (the issuer) control.
//      Every investor subname will point at this resolver, never their own —
//      that's what stops an investor forging their own KYC status.
//   2. Deploy a UserRegistry proxy for the investor namespace.
//   3. Call ETHRegistry.setSubregistry(labelhash("namegate"), userRegistry).
//      Skipping this is the classic silent failure: subnames mint but never
//      resolve.
//
// Run: npm run ens:setup

import {
  encodeFunctionData,
  keccak256,
  toHex,
  namehash,
  toEventSelector,
  getAddress,
} from "viem";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { ENSV2_SEPOLIA, PARENT_NAME } from "../src/constants.js";
import {
  permissionedResolverAbi,
  userRegistryAbi,
  verifiableFactoryAbi,
  ALL_ROLES,
} from "../src/abi.js";
import { sepolia } from "viem/chains";
import { confirmTransaction } from "../../shared/src/tx.js";

// Deployed proxy implementations — see the deployments table cross-check in
// research-notes/task-c-ensv2-writepath.md [c2]. Re-verify against
// https://docs.ens.domains/learn/deployments/ if this script errors with a
// bytecode/interface mismatch — ENSv2 is under audit through 2026-09-14 and
// addresses may move.
const PERMISSIONED_RESOLVER_IMPL =
  "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e" as const;
const USER_REGISTRY_IMPL = "0x624a25d67b59d587752ebec8dded8827dae52050" as const;

async function deployProxy(
  implementation: `0x${string}`,
  saltSeed: string,
  initData: `0x${string}`,
  issuerAddress: `0x${string}`,
) {
  const salt = BigInt(
    keccak256(
      // keccak256(abi.encode(keccak256(saltSeed), owner, 0)) per [c6]
      (await import("viem")).encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [keccak256(toHex(saltSeed)), issuerAddress, 0n],
      ),
    ),
  );

  const walletClient = getWalletClient();
  const hash = await walletClient.writeContract({
    address: ENSV2_SEPOLIA.verifiableFactory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [implementation, salt, initData],
    chain: sepolia,
    account: walletClient.account!,
  });
  const receipt = await confirmTransaction(publicClient, hash, "Namespace setup");

  // Match on the event signature, not just "first log from the factory" — a
  // factory that emitted anything else first would otherwise have an
  // unrelated topic read as an address, producing a plausible-looking but
  // wrong deployment address that only fails much later.
  const proxyDeployedTopic = toEventSelector(
    "ProxyDeployed(address,address,uint256,address)",
  );
  const log = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === ENSV2_SEPOLIA.verifiableFactory.toLowerCase() &&
      l.topics[0] === proxyDeployedTopic,
  );
  if (!log) throw new Error("ProxyDeployed event not found in receipt");

  // topics: [0] = event sig, [1] = sender, [2] = proxyAddress
  const proxyAddress = getAddress(`0x${log.topics[2]!.slice(-40)}`);

  const deployedCode = await publicClient.getCode({ address: proxyAddress });
  if (!deployedCode || deployedCode === "0x") {
    throw new Error(
      `ProxyDeployed reported ${proxyAddress}, but there is no bytecode there.`,
    );
  }
  console.log(`  -> deployed at ${proxyAddress} (tx ${hash})`);
  return proxyAddress;
}

async function main() {
  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();
  console.log(`Issuer account: ${issuerAccount.address}`);
  console.log(`Setting up namespace under ${PARENT_NAME}\n`);

  console.log("1/3 Deploying issuer-controlled PermissionedResolver...");
  const resolverInit = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [issuerAccount.address, ALL_ROLES, []],
  });
  const resolverAddress = await deployProxy(
    PERMISSIONED_RESOLVER_IMPL,
    "OwnedResolver",
    resolverInit,
    issuerAccount.address,
  );

  console.log("\n2/3 Deploying UserRegistry for the investor namespace...");
  const registryInit = encodeFunctionData({
    abi: userRegistryAbi,
    functionName: "initialize",
    args: [issuerAccount.address, ALL_ROLES],
  });
  const userRegistryAddress = await deployProxy(
    USER_REGISTRY_IMPL,
    "UserRegistry",
    registryInit,
    issuerAccount.address,
  );

  // Derived from PARENT_NAME rather than hardcoded, so changing the parent
  // cannot leave this linking a different name than everything else uses.
  const parentLabel = PARENT_NAME.split(".")[0]!;
  console.log(`\n3/3 Linking ${PARENT_NAME} to the new UserRegistry via setSubregistry...`);
  const labelhash = keccak256(toHex(parentLabel));
  const hash = await walletClient.writeContract({
    address: ENSV2_SEPOLIA.ethRegistry,
    abi: userRegistryAbi, // setSubregistry lives on the same interface shape
    functionName: "setSubregistry",
    args: [BigInt(labelhash), userRegistryAddress],
    chain: sepolia,
    account: walletClient.account!,
  });
  await confirmTransaction(publicClient, hash, "Linking the subregistry");

  // The header warns that skipping setSubregistry mints names that never
  // resolve. A mined transaction does not prove the link took, so read it
  // back — this is the single highest-value check in the script.
  const linked = await publicClient.readContract({
    address: ENSV2_SEPOLIA.ethRegistry,
    abi: userRegistryAbi,
    functionName: "getSubregistry",
    args: [parentLabel],
  });
  if (linked.toLowerCase() !== userRegistryAddress.toLowerCase()) {
    throw new Error(
      `setSubregistry mined, but ${PARENT_NAME} points at ${linked} rather than ` +
        `${userRegistryAddress}. Subnames registered under it would never resolve.`,
    );
  }
  console.log(`  -> done (tx ${hash}), verified ${PARENT_NAME} -> ${linked}`);

  console.log("\nSave these to .env for the next scripts:");
  console.log(`ISSUER_RESOLVER_ADDRESS=${resolverAddress}`);
  console.log(`ISSUER_USER_REGISTRY_ADDRESS=${userRegistryAddress}`);
  console.log(`\nParent node (for reference): ${namehash(PARENT_NAME)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
