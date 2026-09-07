import { useCallback, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { NavBarConnected, NavBarUnconfigured } from "./components/NavBar";
import { BondTerms } from "./components/BondTerms";
import { InvestorCard } from "./components/InvestorCard";
import {
  readInvestor,
  readBondTerms,
  type InvestorView,
  type BondTerms as BondTermsData,
} from "./lib/read";
import { publishCompliance, distributeCoupon, type MinimalEip1193Provider } from "./lib/actions";
import { env } from "./lib/env";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bond: BondTermsData; investorA: InvestorView; investorB: InvestorView };

function useDashboardData(refreshKey: number) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    Promise.all([
      readBondTerms(),
      readInvestor(env.investorALabel, env.investorAAddress),
      readInvestor(env.investorBLabel, env.investorBAddress),
    ])
      .then(([bond, investorA, investorB]) => {
        if (!cancelled) setState({ status: "ready", bond, investorA, investorB });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return state;
}

type WalletAccess = {
  connected: boolean;
  connect: () => void;
  getProvider: () => Promise<{ provider: MinimalEip1193Provider; account: `0x${string}` }>;
  nav: React.ReactNode;
};

function Dashboard({ wallet }: { wallet: WalletAccess }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const state = useDashboardData(refreshKey);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function handlePublish(label: string) {
    if (!wallet.connected) {
      wallet.connect();
      return;
    }
    setBusyLabel(`publish:${label}`);
    setActionMessage(null);
    try {
      const { provider, account } = await wallet.getProvider();
      const result = await publishCompliance(provider, account, label);
      setActionMessage(
        `Published ${label}. CCIP message ${result.messageId} — track at ` +
          `https://ccip.chain.link/msg/${result.messageId}`,
      );
      refresh();
    } catch (error) {
      setActionMessage(`Publish failed: ${(error as Error).message}`);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handleDistribute(investor: InvestorView) {
    if (!wallet.connected) {
      wallet.connect();
      return;
    }
    setBusyLabel(`distribute:${investor.label}`);
    setActionMessage(null);
    try {
      const { provider, account } = await wallet.getProvider();
      const result = await distributeCoupon(provider, account, investor.address);
      setActionMessage(
        `Paid ${investor.label} ${(Number(result.amountTinybar) / 1e8).toFixed(4)} HBAR — tx ${result.txHash}`,
      );
      refresh();
    } catch (error) {
      setActionMessage(`Distribute failed: ${(error as Error).message}`);
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <div className="flex flex-col gap-7 max-w-[680px] mx-auto py-8 px-4">
      {wallet.nav}

      <div className="px-1">
        <p className="text-[34px] font-medium leading-tight m-0 mb-2.5 tracking-tight">
          investora.namegate.eth
          <br />
          is cleared to receive.
        </p>
        <p className="text-[15px] m-0" style={{ color: "var(--text-secondary)" }}>
          investorb.namegate.eth isn't — the record says why, live.
        </p>
      </div>

      {state.status === "loading" && (
        <p style={{ color: "var(--text-secondary)" }}>Reading Sepolia and Hedera testnet...</p>
      )}
      {state.status === "error" && (
        <p style={{ color: "var(--text-danger)" }}>Failed to read chain state: {state.message}</p>
      )}

      {state.status === "ready" && (
        <>
          <div>
            <p className="text-[13px] m-0 mb-2" style={{ color: "var(--text-secondary)" }}>
              Bond terms
            </p>
            <BondTerms terms={state.bond} />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
                Investors
              </p>
              <button onClick={refresh}>Refresh</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[state.investorA, state.investorB].map((investor) => (
                <div className="flex flex-col gap-2" key={investor.label}>
                  <InvestorCard
                    investor={investor}
                    onDistribute={handleDistribute}
                    distributing={busyLabel === `distribute:${investor.label}`}
                  />
                  <button
                    className="w-full text-[12px]"
                    disabled={busyLabel === `publish:${investor.label}`}
                    onClick={() => handlePublish(investor.label)}
                  >
                    {busyLabel === `publish:${investor.label}`
                      ? "Publishing..."
                      : wallet.connected
                        ? "Publish latest"
                        : "Connect wallet to publish"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {actionMessage && (
            <p className="text-[13px] break-all" style={{ color: "var(--text-secondary)" }}>
              {actionMessage}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Real wallet access, backed by Privy — only mounted inside a PrivyProvider. */
function ConnectedDashboard() {
  const privy = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets[0];

  const wallet: WalletAccess = {
    connected: privy.authenticated && Boolean(activeWallet),
    connect: () => privy.login(),
    getProvider: async () => {
      if (!activeWallet) throw new Error("Connect a wallet first.");
      const provider = await activeWallet.getEthereumProvider();
      return { provider, account: activeWallet.address as `0x${string}` };
    },
    nav: <NavBarConnected />,
  };

  return <Dashboard wallet={wallet} />;
}

/** No Privy app id configured — read-only dashboard, no wallet hooks touched. */
function ReadOnlyDashboard() {
  const wallet: WalletAccess = {
    connected: false,
    connect: () => {
      window.alert("Set VITE_PRIVY_APP_ID to enable wallet connect and on-chain actions.");
    },
    getProvider: async () => {
      throw new Error("Wallet connect is not configured (VITE_PRIVY_APP_ID is empty).");
    },
    nav: <NavBarUnconfigured />,
  };

  return <Dashboard wallet={wallet} />;
}

export function App({ privyConfigured }: { privyConfigured: boolean }) {
  return privyConfigured ? <ConnectedDashboard /> : <ReadOnlyDashboard />;
}
