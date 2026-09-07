import { createPublicClient, http } from "viem";
import { sepolia, hederaTestnet } from "viem/chains";
import { env } from "./env";

export const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(env.sepoliaRpcUrl),
});

export const hederaClient = createPublicClient({
  chain: hederaTestnet,
  transport: http(env.hederaRpcUrl),
});
