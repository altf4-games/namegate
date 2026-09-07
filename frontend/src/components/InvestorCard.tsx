import type { InvestorView } from "../lib/read";
import { shortenAddress, formatDate, formatTinybarAsHbar } from "../lib/format";

type Props = {
  investor: InvestorView;
  onDistribute: (investor: InvestorView) => void;
  distributing: boolean;
};

export function InvestorCard({ investor, onDistribute, distributing }: Props) {
  const eligible = investor.record.authorized;
  const canDistribute =
    investor.mirrorAuthorized && !investor.alreadyPaid && investor.couponAmountTinybar > 0n;

  return (
    <div className="rounded-xl border-[0.5px] p-4" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-medium text-[15px] m-0">{investor.label}.namegate.eth</p>
          <p className="text-[13px] m-0 mt-0.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            {shortenAddress(investor.address)}
          </p>
        </div>
        <span
          className="text-[12px] px-2.5 py-1 rounded-md whitespace-nowrap"
          style={
            eligible
              ? { background: "var(--bg-success)", color: "var(--text-success)" }
              : { background: "var(--bg-danger)", color: "var(--text-danger)" }
          }
        >
          {eligible ? "Authorized" : "Blocked"}
        </span>
      </div>

      <div className="border-t-[0.5px] pt-2.5 flex flex-col gap-1.5 mb-3" style={{ borderColor: "var(--border)" }}>
        <Row label="KYC" value={investor.record.kyc || "(unset)"} />
        <Row label="Jurisdiction" value={investor.record.jurisdiction || "(unset)"} />
        <Row label="Accreditation" value={investor.record.accreditationExpiry || "(unset)"} />
        <Row
          label="Lockup until"
          value={
            investor.record.lockupUntilTimestamp === 0n
              ? "Expired"
              : formatDate(investor.record.lockupUntilTimestamp)
          }
          danger={investor.record.lockupUntilTimestamp > 0n}
        />
        <Row
          label="Hedera enforces"
          value={investor.mirrorAuthorized ? "Authorized" : "Blocked"}
          danger={!investor.mirrorAuthorized}
          hint={
            investor.mirrorAuthorized !== eligible
              ? "stale — publish to sync with ENS"
              : undefined
          }
        />
      </div>

      <p className="text-[12px] m-0 mb-3" style={{ color: "var(--text-secondary)" }}>
        {investor.description}
      </p>

      {investor.alreadyPaid ? (
        <button className="w-full flex items-center justify-center gap-1.5 text-[13px]" disabled>
          Coupon already paid
        </button>
      ) : (
        <button
          className="w-full flex items-center justify-center gap-1.5 text-[13px]"
          disabled={!canDistribute || distributing}
          onClick={() => onDistribute(investor)}
        >
          {distributing
            ? "Distributing..."
            : !investor.mirrorAuthorized
              ? "Locked — publish first"
              : investor.couponAmountTinybar === 0n
                ? "Nothing owed yet"
                : `Distribute ${formatTinybarAsHbar(investor.couponAmountTinybar)} HBAR`}
        </button>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  danger,
  hint,
}: {
  label: string;
  value: string;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex justify-between text-[13px]">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: danger ? "var(--text-danger)" : "var(--text-primary)" }}>
        {value}
        {hint ? (
          <span style={{ color: "var(--text-muted)" }}> ({hint})</span>
        ) : null}
      </span>
    </div>
  );
}
