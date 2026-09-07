import { useCallback, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { NavBarConnected, NavBarUnconfigured } from "./components/NavBar";
import { BondTerms } from "./components/BondTerms";
import { InvestorCard } from "./components/InvestorCard";
import { OnboardInvestor } from "./components/OnboardInvestor";
import { readInvestor, readBondTerms, type InvestorView, type BondTerms as BondTermsData } from "./lib/read";
import { publishCompliance, distributeCoupon, type MinimalEip1193Provider } from "./lib/actions";
import { loadInvestors, saveOnboardedInvestor, type InvestorEntry } from "./lib/investors";

type ActionMessage = { kind: "success" | "error"; text: string; link?: string; linkLabel?: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bond: BondTermsData; investors: InvestorView[] };

function useDashboardData(entries: InvestorEntry[], refreshKey: number) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    Promise.all([readBondTerms(), ...entries.map((e) => readInvestor(e.label, e.address))])
      .then(([bond, ...investors]) => {
        if (!cancelled) setState({ status: "ready", bond, investors });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
    // entries' identity changes each render (new array from loadInvestors());
    // compare by its labels instead, so onboarding one new investor doesn't
    // refetch investors that haven't changed on top of the ones that did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.map((e) => e.label).join(","), refreshKey]);

  return state;
}

type WalletAccess = {
  connected: boolean;
  connect: () => void;
  getProvider: () => Promise<{ provider: MinimalEip1193Provider; account: `0x${string}` }>;
  nav: React.ReactNode;
};

function Dashboard({ wallet }: { wallet: WalletAccess }) {
  const [entries, setEntries] = useState<InvestorEntry[]>(() => loadInvestors());
  const [refreshKey, setRefreshKey] = useState(0);
  const state = useDashboardData(entries, refreshKey);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);

  function handleOnboarded(label: string, address: `0x${string}`) {
    setEntries(saveOnboardedInvestor({ label, address }));
  }

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
      setActionMessage({
        kind: "success",
        text: `Published ${label} to Hedera over CCIP.`,
        link: `https://ccip.chain.link/msg/${result.messageId}`,
        linkLabel: "Track delivery",
      });
      refresh();
    } catch (error) {
      setActionMessage({ kind: "error", text: `Publish failed: ${(error as Error).message}` });
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
      setActionMessage({
        kind: "success",
        text: `Paid ${investor.label} ${(Number(result.amountTinybar) / 1e8).toFixed(4)} HBAR.`,
        link: `https://hashscan.io/testnet/tx/${result.txHash}`,
        linkLabel: "View on HashScan",
      });
      refresh();
    } catch (error) {
      setActionMessage({ kind: "error", text: `Distribute failed: ${(error as Error).message}` });
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <div className="flex flex-col gap-7 max-w-[680px] mx-auto py-8 px-4">
      {wallet.nav}

      <div className="px-1">
        <p className="text-[26px] sm:text-[34px] font-medium leading-tight m-0 mb-2.5 tracking-tight">
          ENS names, not a database,
          <br />
          decide who gets paid.
        </p>
        <p className="text-[15px] m-0" style={{ color: "var(--text-secondary)" }}>
          Every investor below reads straight from Sepolia and Hedera testnet, live.
        </p>
      </div>

      {state.status === "loading" && <DashboardSkeleton />}
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
                Investors ({state.investors.length})
              </p>
              <button onClick={refresh}>Refresh</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {state.investors.map((investor) => (
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

          <OnboardInvestor
            connected={wallet.connected}
            connect={wallet.connect}
            getProvider={wallet.getProvider}
            onOnboarded={handleOnboarded}
          />

          {actionMessage && (
            <ActionBanner message={actionMessage} onDismiss={() => setActionMessage(null)} />
          )}
        </>
      )}
    </div>
  );
}

function ActionBanner({ message, onDismiss }: { message: ActionMessage; onDismiss: () => void }) {
  const success = message.kind === "success";
  return (
    <div
      className="rounded-lg px-4 py-3 flex items-start justify-between gap-3 text-[13px]"
      style={{
        background: success ? "var(--bg-success)" : "var(--bg-danger)",
        color: success ? "var(--text-success)" : "var(--text-danger)",
      }}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <span className="break-words">{message.text}</span>
        {message.link && (
          <a href={message.link} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
            {message.linkLabel ?? message.link} &rarr;
          </a>
        )}
      </div>
      <button
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{ border: "none", background: "transparent", padding: 0, color: "inherit" }}
      >
        <i className="ti ti-x" style={{ fontSize: 16 }} aria-hidden="true" />
      </button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-7 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] rounded-lg" style={{ background: "var(--surface-1)" }} />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-[220px] rounded-xl" style={{ background: "var(--surface-1)" }} />
        ))}
      </div>
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
