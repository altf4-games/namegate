import { usePrivy } from "@privy-io/react-auth";
import { shortenAddress } from "../lib/format";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-wrap justify-between items-center gap-2.5 rounded-full border-[0.5px] px-4 py-2.5"
      style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3.5">
        <p className="font-medium text-[15px] m-0 tracking-tight">NameGate</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge label="ENS" color="var(--fill-accent)" />
          <Badge label="Hedera" color="var(--fill-success)" />
          <Badge label="CCIP" color="var(--fill-pro)" />
        </div>
      </div>
      {children}
    </div>
  );
}

/** Rendered only when VITE_PRIVY_APP_ID is set and the tree is wrapped in a real PrivyProvider. */
export function NavBarConnected() {
  const privy = usePrivy();

  return (
    <Shell>
      {privy.authenticated ? (
        <div className="flex items-center gap-2.5">
          <span
            className="text-[13px]"
            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
          >
            {privy.user?.wallet?.address ? shortenAddress(privy.user.wallet.address) : "connected"}
          </span>
          <button onClick={() => privy.logout()}>Disconnect</button>
        </div>
      ) : (
        <button onClick={() => privy.login()}>Connect wallet</button>
      )}
    </Shell>
  );
}

/** Rendered when there's no Privy app id — read-only mode, no hooks touched. */
export function NavBarUnconfigured() {
  return (
    <Shell>
      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        Wallet connect not configured — set VITE_PRIVY_APP_ID
      </span>
    </Shell>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full"
      style={{ background: "var(--surface-1)", color: "var(--text-secondary)" }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
