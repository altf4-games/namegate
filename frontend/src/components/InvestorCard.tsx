import type { InvestorView } from "../lib/read";
import { shortenAddress, formatTinybarAsHbar, formatTinybarAsUsd } from "../lib/format";
import {
  ensStatus,
  hederaStatus,
  isStale,
  lockupLabel,
  blockReason,
  distributeButtonState,
  type DistributeButtonState,
} from "../lib/status";

type Props = {
  investor: InvestorView;
  bondPaused: boolean;
  hbarUsdCents: bigint;
  onDistribute: (investor: InvestorView) => void;
  distributing: boolean;
};

export function InvestorCard({ investor, bondPaused, hbarUsdCents, onDistribute, distributing }: Props) {
  const ens = ensStatus(investor);
  const hedera = hederaStatus(investor);
  const stale = isStale(investor);
  const reason = blockReason(investor, bondPaused);
  const buttonState = distributeButtonState(investor, distributing);

  return (
    <div
      className="rounded-xl border-[0.5px] p-4 flex flex-col"
      style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="min-w-0">
          <p className="font-medium text-[15px] m-0 truncate">{investor.label}.namegate.eth</p>
          <p
            className="text-[13px] m-0 mt-0.5"
            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
          >
            {shortenAddress(investor.address)}
          </p>
        </div>
        <StatusBadge status={ens} />
      </div>

      {reason && (
        <div
          className="rounded-lg px-3 py-2 mb-3 text-[12px] leading-snug"
          style={{ background: "var(--bg-danger)", color: "var(--text-danger)" }}
        >
          <span className="font-medium">Blocked:</span> {reason}.
        </div>
      )}

      <div
        className="border-t-[0.5px] pt-2.5 flex flex-col gap-1.5 mb-3"
        style={{ borderColor: "var(--border)" }}
      >
        <Row label="KYC" value={investor.record.kyc || "(unset)"} />
        <Row label="Jurisdiction" value={investor.record.jurisdiction || "(unset)"} />
        <Row label="Accreditation" value={investor.record.accreditationExpiry || "(unset)"} />
        <Row
          label="Lockup until"
          value={lockupLabel(investor)}
          danger={investor.record.lockupUntilTimestamp > 0n}
        />
        <div className="flex justify-between items-center text-[13px]">
          <span style={{ color: "var(--text-secondary)" }}>Hedera enforces</span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: hedera === "authorized" ? "var(--fill-success)" : "var(--fill-danger)" }}
            />
            <span style={{ color: hedera === "authorized" ? "var(--text-success)" : "var(--text-danger)" }}>
              {hedera === "authorized" ? "Authorized" : "Blocked"}
            </span>
            {stale && (
              <span
                className="text-[11px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--bg-warning)", color: "var(--text-warning)" }}
              >
                stale
              </span>
            )}
          </span>
        </div>
      </div>

      {reason ? (
        <div className="grow" />
      ) : (
        <p className="text-[12px] m-0 mb-3 grow" style={{ color: "var(--text-secondary)" }}>
          {investor.description}
        </p>
      )}

      <DistributeButton
        state={buttonState}
        investor={investor}
        hbarUsdCents={hbarUsdCents}
        onDistribute={onDistribute}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: "authorized" | "blocked" }) {
  const authorized = status === "authorized";
  return (
    <span
      className="text-[12px] px-2.5 py-1 rounded-md whitespace-nowrap shrink-0"
      style={
        authorized
          ? { background: "var(--bg-success)", color: "var(--text-success)" }
          : { background: "var(--bg-danger)", color: "var(--text-danger)" }
      }
    >
      {authorized ? "Authorized" : "Blocked"}
    </span>
  );
}

function DistributeButton({
  state,
  investor,
  hbarUsdCents,
  onDistribute,
}: {
  state: DistributeButtonState;
  investor: InvestorView;
  hbarUsdCents: bigint;
  onDistribute: (investor: InvestorView) => void;
}) {
  const usd = formatTinybarAsUsd(investor.couponAmountTinybar, hbarUsdCents);
  const readyLabel =
    `Distribute ${formatTinybarAsHbar(investor.couponAmountTinybar)} HBAR` +
    (usd ? ` (≈ ${usd})` : "");
  const labels: Record<DistributeButtonState["kind"], string> = {
    "already-paid": "Coupon already paid",
    locked: "Locked — publish first",
    "nothing-owed": "Nothing owed yet",
    distributing: "Distributing...",
    ready: readyLabel,
  };

  return (
    <button
      className="w-full flex items-center justify-center gap-1.5 text-[13px]"
      disabled={state.kind !== "ready"}
      onClick={() => onDistribute(investor)}
    >
      {labels[state.kind]}
    </button>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: danger ? "var(--text-danger)" : "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
