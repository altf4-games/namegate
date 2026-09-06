// Submits a k-of-n EIP-712 attestation of an investor's compliance state
// directly to the Hedera mirror, bypassing CCIP entirely — the fallback for
// live Q&A while a real CCIP message is still in flight (documented latency
// minutes; observed as long as ~20 minutes in this project).
//
// The compliance state attested to is read from the SAME beacon contract on
// Sepolia that would otherwise publish it — readCompliance() is a free view
// call — so this is not a second, independently-reasoned answer that could
// silently disagree with the on-chain rule. It reads the beacon's verdict
// and asks signers to attest to exactly that.
//
// Signing happens locally with whichever ATTESTATION_SIGNER_N_KEY values are
// present in .env, up to the threshold the mirror requires — never sent
// anywhere, never logged.
//
// Run: npm run hedera:submit-attestation -- investora

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient as sepoliaPublicClient } from "../../ens/src/client.js";
import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { normalizePrivateKey } from "../../shared/src/normalizePrivateKey.js";

const mirrorArtifactPath = fileURLToPath(
  new URL(
    "../../artifacts/contracts/hedera/ENSComplianceMirror.sol/ENSComplianceMirror.json",
    import.meta.url,
  ),
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env — see .env.example.`);
  return value;
}

const ATTESTATION_TYPES = {
  ComplianceAttestation: [
    { name: "node", type: "bytes32" },
    { name: "owner", type: "address" },
    { name: "authorized", type: "bool" },
    { name: "kyc", type: "string" },
    { name: "jurisdiction", type: "string" },
    { name: "accreditationExpiry", type: "string" },
    { name: "lockupUntil", type: "string" },
    { name: "lockupUntilTimestamp", type: "uint64" },
    { name: "nameExpiry", type: "uint64" },
    { name: "attestedAt", type: "uint256" },
  ],
} as const;

type BeaconRecord = {
  resolver: `0x${string}`;
  owner: `0x${string}`;
  node: `0x${string}`;
  kyc: string;
  jurisdiction: string;
  accreditationExpiry: string;
  lockupUntil: string;
  lockupUntilTimestamp: bigint;
  nameExpiry: bigint;
  authorized: boolean;
};

async function main() {
  const label = process.argv[2];
  if (!label) {
    throw new Error("Usage: npm run hedera:submit-attestation -- <label>   (e.g. investora)");
  }

  const beaconAddress = requireEnv("BEACON_ADDRESS") as `0x${string}`;
  const mirrorAddress = requireEnv("MIRROR_ADDRESS") as `0x${string}`;
  const mirrorArtifact = JSON.parse(readFileSync(mirrorArtifactPath, "utf-8")) as {
    abi: unknown[];
  };

  const beaconAbi = [
    {
      type: "function",
      name: "readCompliance",
      stateMutability: "view",
      inputs: [{ name: "label", type: "string" }],
      outputs: [
        {
          type: "tuple",
          components: [
            { name: "resolver", type: "address" },
            { name: "owner", type: "address" },
            { name: "node", type: "bytes32" },
            { name: "kyc", type: "string" },
            { name: "jurisdiction", type: "string" },
            { name: "accreditationExpiry", type: "string" },
            { name: "lockupUntil", type: "string" },
            { name: "lockupUntilTimestamp", type: "uint64" },
            { name: "nameExpiry", type: "uint64" },
            { name: "authorized", type: "bool" },
          ],
        },
      ],
    },
  ] as const;

  console.log(`Reading ${label}'s compliance state from the beacon (Sepolia)...`);
  const record = (await sepoliaPublicClient.readContract({
    address: beaconAddress,
    abi: beaconAbi,
    functionName: "readCompliance",
    args: [label],
  })) as BeaconRecord;

  const attestedAt = BigInt(Math.floor(Date.now() / 1000));
  const value = {
    node: record.node,
    owner: record.owner,
    authorized: record.authorized,
    kyc: record.kyc,
    jurisdiction: record.jurisdiction,
    accreditationExpiry: record.accreditationExpiry,
    lockupUntil: record.lockupUntil,
    lockupUntilTimestamp: record.lockupUntilTimestamp,
    nameExpiry: record.nameExpiry,
    attestedAt,
  };

  console.log();
  console.log(`Node:       ${value.node}`);
  console.log(`Owner:      ${value.owner}`);
  console.log(`Authorized: ${value.authorized}`);
  console.log(`Attested at: ${new Date(Number(attestedAt) * 1000).toISOString()}`);
  console.log();

  const threshold = Number(
    await publicClient.readContract({
      address: mirrorAddress,
      abi: mirrorArtifact.abi as never,
      functionName: "attestationThreshold",
    }),
  );

  const availableKeys = [
    process.env.ATTESTATION_SIGNER_1_KEY,
    process.env.ATTESTATION_SIGNER_2_KEY,
    process.env.ATTESTATION_SIGNER_3_KEY,
  ].filter((k): k is string => Boolean(k));

  if (availableKeys.length < threshold) {
    throw new Error(
      `Mirror requires ${threshold} signatures, but only ${availableKeys.length} ` +
        "ATTESTATION_SIGNER_*_KEY values are set in .env.",
    );
  }

  const network = await publicClient.getChainId();
  const domain = {
    name: "NameGateENSComplianceMirror",
    version: "1",
    chainId: network,
    verifyingContract: mirrorAddress,
  } as const;

  const signingKeys = availableKeys.slice(0, threshold);
  const signed = await Promise.all(
    signingKeys.map(async (rawKey) => {
      const account = privateKeyToAccount(normalizePrivateKey(rawKey, "ATTESTATION_SIGNER_KEY"));
      const signature = await account.signTypedData({
        domain,
        types: ATTESTATION_TYPES,
        primaryType: "ComplianceAttestation",
        message: value,
      });
      return { address: account.address.toLowerCase(), signature };
    }),
  );
  // submitAttestation requires signatures sorted by recovered address,
  // strictly increasing — the standard cheap way to prove a set of DISTINCT
  // signers on-chain without a bitmap.
  signed.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

  console.log(`Signed by ${signed.length} of ${threshold} required signers:`);
  for (const s of signed) console.log(`  ${s.address}`);
  console.log();

  const walletClient = getWalletClient();
  const account = getIssuerAccount();
  const hash = await walletClient.writeContract({
    address: mirrorAddress,
    abi: mirrorArtifact.abi as never,
    functionName: "submitAttestation",
    args: [value, signed.map((s) => s.signature)],
    account,
    chain: publicClient.chain,
  });
  console.log(`Submit tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`submitAttestation reverted. Receipt status: ${receipt.status}`);
  }

  const authorizedNow = await publicClient.readContract({
    address: mirrorAddress,
    abi: mirrorArtifact.abi as never,
    functionName: "isAuthorized",
    args: [record.owner],
  });
  console.log();
  console.log(`Applied. mirror.isAuthorized(${record.owner}) = ${authorizedNow}`);
  if (authorizedNow !== record.authorized) {
    throw new Error(
      "Mirror's isAuthorized does not match the attested verdict after submission — " +
        "check for a newer, conflicting update already applied for this node.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
