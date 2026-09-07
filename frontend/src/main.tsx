import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { sepolia, hederaTestnet } from "viem/chains";
import { App } from "./App";
import { env } from "./lib/env";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
const privyConfigured = env.privyAppId !== "";

root.render(
  <StrictMode>
    {privyConfigured ? (
      <PrivyProvider
        appId={env.privyAppId}
        config={{
          appearance: { theme: "light" },
          defaultChain: sepolia,
          supportedChains: [sepolia, hederaTestnet],
          embeddedWallets: { createOnLogin: "users-without-wallets" },
        }}
      >
        <App privyConfigured />
      </PrivyProvider>
    ) : (
      <App privyConfigured={false} />
    )}
  </StrictMode>,
);
