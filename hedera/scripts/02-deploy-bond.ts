// Day 1, Gate B (docs/BUILD-PLAN.md): deploys a minimal bond from the
// published ATS testnet Factory, with our control list registered at
// deploy time via SecurityData.externalControlLists. This is the concrete
// test of the open question from research-notes/task-d-hedera-ats.md — does
// the deployed factory (documented Smart Contract Version 4.0.0) actually
// carry the external-list facets? If this call reverts on an unrecognized
// field/selector, it doesn't, and `deploy:newBlr:hedera:testnet` from the
// ATS repo itself is the fallback (docs/ARCHITECTURE.md, "Two unresolved
// questions").
//
// Run: npm run hedera:deploy-bond

import { publicClient, getWalletClient, getIssuerAccount } from "../src/client.js";
import { factoryAbi } from "../src/abi.js";
import {
  ATS_TESTNET,
  BOND_CONFIG_ID,
  ATS_ROLES,
  RegulationType,
  RegulationSubType,
} from "../src/constants.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

async function main() {
  const issuerAccount = getIssuerAccount();
  const walletClient = getWalletClient();

  const controlListAddress = process.env.ENS_CONTROL_LIST_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!controlListAddress) {
    throw new Error(
      "Set ENS_CONTROL_LIST_ADDRESS in .env (printed by " +
        "01-deploy-control-list.ts). Deploying without it defeats the point " +
        "of Day 1 Gate B — you'd have a bond with no compliance hook.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;
  // startingDate must be strictly > block.timestamp AT EXECUTION time, not
  // at simulation time (layer_0/scheduledTasks/ScheduledTasksCommon.sol:
  // WrongTimestamp). A few seconds always pass between simulate and
  // broadcast, so "now" goes stale — give it real headroom.
  const startingDate = now + 600;

  const bondData = {
    security: {
      resolver: ATS_TESTNET.blrProxy,
      // At this factory version, 0 is NOT "unlimited" — it's rejected
      // outright (layer_0/cap/CapStorageWrapper2.sol: NewMaxSupplyCannotBeZero).
      // Set a real cap.
      maxSupply: 1_000_000_000n,
      resolverProxyConfiguration: { key: BOND_CONFIG_ID, version: 1n },
      erc20MetadataInfo: {
        name: "NameGate Demo Bond",
        symbol: "NGB",
        // Must pass a real ISO 6166 checksum, not just be 12 chars — ATS
        // validates it on-chain (factory/isinValidator.sol, WrongISINChecksum).
        // This is the same placeholder ATS's own docs use.
        isin: "US0378331005",
        decimals: 6,
      },
      rbacs: [
        { role: ATS_ROLES.DEFAULT_ADMIN_ROLE, members: [issuerAccount.address] },
        { role: ATS_ROLES.ROLE_ISSUER, members: [issuerAccount.address] },
        { role: ATS_ROLES.ROLE_CORPORATE_ACTION, members: [issuerAccount.address] },
        { role: ATS_ROLES.ROLE_CONTROL_LIST_MANAGER, members: [issuerAccount.address] },
      ],
      externalPauses: [],
      // The whole point of Day 1 Gate B: register NameGate's control list
      // at deploy time, not as an afterthought.
      externalControlLists: [controlListAddress],
      externalKycLists: [],
      compliance: ZERO_ADDRESS,
      identityRegistry: ZERO_ADDRESS,
      arePartitionsProtected: false,
      isMultiPartition: false,
      isControllable: true,
      isWhiteList: false, // gating is via externalControlLists, not ATS's own whitelist
      clearingActive: false,
      internalKycActivated: false,
      erc20VotesActivated: false,
    },
    bondDetails: {
      currency: "0x555344" as `0x${string}`, // "USD" as bytes3
      nominalValue: 1_000_000n, // 1.000000, 6 decimals
      nominalValueDecimals: 6,
      startingDate: BigInt(startingDate),
      maturityDate: BigInt(startingDate + oneYear),
    },
    proceedRecipients: [] as `0x${string}`[],
    proceedRecipientsData: [] as `0x${string}`[],
  };

  const factoryRegulationData = {
    regulationType: RegulationType.REG_D,
    regulationSubType: RegulationSubType.REG_D_506_C,
    additionalSecurityData: {
      countriesControlListType: false,
      listOfCountries: "",
      info: "NameGate demo bond — eligibility sourced from ENSv2 Sepolia",
    },
  };

  console.log("Simulating deployBond (to read the return value before spending gas)...");
  const { result: bondAddress } = await publicClient.simulateContract({
    address: ATS_TESTNET.factoryProxy,
    abi: factoryAbi,
    functionName: "deployBond",
    args: [bondData, factoryRegulationData],
    account: issuerAccount,
  });
  console.log(`Simulation OK. Bond will deploy at ${bondAddress}`);

  const hash = await walletClient.writeContract({
    address: ATS_TESTNET.factoryProxy,
    abi: factoryAbi,
    functionName: "deployBond",
    args: [bondData, factoryRegulationData],
    chain: undefined,
    account: issuerAccount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Done. tx ${hash} (block ${receipt.blockNumber})`);
  console.log(`\nSave to .env: BOND_ADDRESS=${bondAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
