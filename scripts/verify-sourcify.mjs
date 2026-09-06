#!/usr/bin/env node
// Verifies a Hardhat-compiled contract against Sourcify's v2 API directly.
//
// Why this exists instead of `hardhat verify`: @nomicfoundation/hardhat-verify
// (as installed here) calls Sourcify's legacy v1 endpoint
// (`/check-all-by-addresses`), which the live server no longer implements —
// confirmed live: that path 404s with a plain HTML error page, not a JSON
// response, which is what actually breaks the plugin ("Unexpected token '<'").
// Sourcify moved to a v2 API (`POST /v2/verify/:chainId/:address`), which the
// installed plugin version doesn't speak yet. This script speaks it directly.
//
// Run: node scripts/verify-sourcify.mjs <chainId> <address> <contractPath:ContractName> [creationTxHash]
// Example:
//   node scripts/verify-sourcify.mjs 296 0xea07... contracts/hedera/ENSComplianceMirror.sol:ENSComplianceMirror 0xd2d4...

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SOURCIFY_API = "https://sourcify.dev/server";

function findBuildInfoFor(contractPath, contractName) {
  const dbgPath = path.join(
    "artifacts",
    contractPath,
    `${contractName}.dbg.json`,
  );
  const dbg = JSON.parse(readFileSync(dbgPath, "utf-8"));
  const buildInfoPath = path.resolve(path.dirname(dbgPath), dbg.buildInfo);
  return JSON.parse(readFileSync(buildInfoPath, "utf-8"));
}

async function main() {
  const [chainId, address, identifier, creationTransactionHash] = process.argv.slice(2);
  if (!chainId || !address || !identifier) {
    console.error(
      "Usage: node scripts/verify-sourcify.mjs <chainId> <address> <path/To/File.sol:ContractName>",
    );
    process.exit(1);
  }

  const [contractPath, contractName] = identifier.split(":");
  if (!contractPath || !contractName) {
    console.error('contractIdentifier must be "path/To/File.sol:ContractName"');
    process.exit(1);
  }

  const buildInfo = findBuildInfoFor(contractPath, contractName);

  const body = {
    stdJsonInput: buildInfo.input,
    compilerVersion: buildInfo.solcLongVersion,
    contractIdentifier: identifier,
    ...(creationTransactionHash ? { creationTransactionHash } : {}),
  };

  console.log(`Submitting ${identifier} at ${address} on chain ${chainId}...`);
  const res = await fetch(`${SOURCIFY_API}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }

  if (!res.ok) {
    throw new Error(`Verification submission failed (HTTP ${res.status}): ${JSON.stringify(json)}`);
  }

  console.log("Submitted:", JSON.stringify(json, null, 2));

  const verificationId = json.verificationId;
  if (!verificationId) {
    console.log("No verificationId returned — inspect the response above.");
    return;
  }

  console.log(`\nPolling status for verificationId ${verificationId}...`);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`${SOURCIFY_API}/v2/verify/${verificationId}`);
    const status = await statusRes.json();
    const match = status.contract?.match;
    console.log(
      `  [${i + 1}] completed=${status.isJobCompleted} match=${match ?? "(pending)"} ` +
        `creationMatch=${status.contract?.creationMatch} runtimeMatch=${status.contract?.runtimeMatch}`,
    );
    if (status.isJobCompleted && (match === "exact_match" || match === "match")) {
      console.log(`\nVerified (${match}). View at:`);
      console.log(`https://repo.sourcify.dev/contracts/full_match/${chainId}/${address}/`);
      console.log(`https://hashscan.io/testnet/contract/${address}`);
      return;
    }
    if (status.isJobCompleted && !match) {
      throw new Error(`Verification job finished with no match: ${JSON.stringify(status)}`);
    }
    if (status.status === "error" || status.status === "failed") {
      throw new Error(`Verification failed: ${JSON.stringify(status)}`);
    }
  }
  console.log("Timed out waiting for a final status — check manually later.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
