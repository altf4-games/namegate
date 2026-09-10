// ABI sources, in order of preference:
//   1. Contracts in THIS repo (beacon, mirror, distributor) — imported
//      straight from Hardhat's compiled artifact JSON, so a change to the
//      Solidity source can never silently drift from what the dashboard
//      calls. Same reasoning as ens/src/beacon.ts's Node-side loader; this
//      is the browser-side equivalent, made possible by vite.config.ts
//      allowing the dev server to serve files from outside frontend/.
//   2. Contracts this repo doesn't own (the ATS bond) — the hand-maintained
//      fragments already reviewed and used by the backend scripts, reused
//      as-is from hedera/src/abi.ts rather than re-transcribed.
import beaconArtifact from "../../../artifacts/contracts/sepolia/ENSComplianceBeacon.sol/ENSComplianceBeacon.json";
import mirrorArtifact from "../../../artifacts/contracts/hedera/ENSComplianceMirror.sol/ENSComplianceMirror.json";
import distributorArtifact from "../../../artifacts/contracts/hedera/CouponDistributor.sol/CouponDistributor.json";
import pauseSwitchArtifact from "../../../artifacts/contracts/hedera/IssuerPauseSwitch.sol/IssuerPauseSwitch.json";
import priceReaderArtifact from "../../../artifacts/contracts/hedera/HbarUsdPriceReader.sol/HbarUsdPriceReader.json";
import { bondErc20Abi, bondCouponAbi } from "../../../hedera/src/abi.js";
import { env } from "./env";

export const beaconAbi = beaconArtifact.abi;
export const mirrorAbi = mirrorArtifact.abi;
export const distributorAbi = distributorArtifact.abi;
export const pauseSwitchAbi = pauseSwitchArtifact.abi;
export const priceReaderAbi = priceReaderArtifact.abi;
export const bondAbi = [...bondErc20Abi, ...bondCouponAbi] as const;

export const addresses = {
  beacon: env.beaconAddress,
  mirror: env.mirrorAddress,
  bond: env.bondAddress,
  distributor: env.distributorAddress,
  pauseSwitch: env.pauseSwitchAddress,
  priceReader: env.priceReaderAddress,
} as const;
