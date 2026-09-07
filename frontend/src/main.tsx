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
          // The dashboard has embedded wallets set to
          // user-controlled-server-wallets-only with create_on_login off
          // (confirmed live against GET /v1/apps/:id) — asking the client
          // SDK to auto-create one on login would fight that server-side
          // setting. Investors connect their own external wallet instead,
          // which also matches the pitch: bring your own wallet, call
          // publish()/distribute() yourself.
          embeddedWallets: { createOnLogin: "off" },
        }}
      >
        <App privyConfigured />
      </PrivyProvider>
    ) : (
      <App privyConfigured={false} />
    )}
  </StrictMode>,
);
