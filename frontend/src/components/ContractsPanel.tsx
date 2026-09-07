import { addresses } from "../lib/contracts";
import { shortenAddress } from "../lib/format";

type ContractRow = {
  name: string;
  address: `0x${string}`;
  chain: "Sepolia" | "Hedera testnet";
  explorerUrl: string;
  verified: boolean | "third-party";
};

const ROWS: ContractRow[] = [
  {
    name: "Beacon",
    address: addresses.beacon,
    chain: "Sepolia",
    explorerUrl: `https://sepolia.etherscan.io/address/${addresses.beacon}#code`,
    verified: true,
  },
  {
    name: "Mirror",
    address: addresses.mirror,
    chain: "Hedera testnet",
    explorerUrl: `https://hashscan.io/testnet/contract/${addresses.mirror}`,
    verified: true,
  },
  {
    name: "Coupon distributor",
    address: addresses.distributor,
    chain: "Hedera testnet",
    explorerUrl: `https://hashscan.io/testnet/contract/${addresses.distributor}`,
    verified: true,
  },
  {
    name: "Bond (ATS)",
    address: addresses.bond,
    chain: "Hedera testnet",
    explorerUrl: `https://hashscan.io/testnet/contract/${addresses.bond}`,
    verified: "third-party",
  },
];

export function ContractsPanel() {
  return (
    <div>
      <p className="text-[13px] m-0 mb-2" style={{ color: "var(--text-secondary)" }}>
        Contracts
      </p>
      <div
        className="rounded-lg border-[0.5px] overflow-hidden"
        style={{ borderColor: "var(--border)" }}
      >
        {ROWS.map((row, i) => (
          <a
            key={row.name}
            href={row.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 px-3 py-2.5 no-underline"
            style={{
              color: "var(--text-primary)",
              background: "var(--surface-2)",
              borderTop: i === 0 ? "none" : "0.5px solid var(--border)",
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[13px] shrink-0">{row.name}</span>
              <span
                className="text-[12px] truncate"
                style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
              >
                {shortenAddress(row.address)}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {row.chain}
              </span>
              <VerifiedBadge status={row.verified} />
              <i className="ti ti-external-link" style={{ fontSize: 14, color: "var(--text-muted)" }} aria-hidden="true" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function VerifiedBadge({ status }: { status: boolean | "third-party" }) {
  if (status === true) {
    return (
      <span
        className="text-[11px] px-2 py-0.5 rounded-full"
        style={{ background: "var(--bg-success)", color: "var(--text-success)" }}
      >
        Verified
      </span>
    );
  }
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full"
      style={{ background: "var(--surface-1)", color: "var(--text-muted)" }}
    >
      Third-party
    </span>
  );
}
