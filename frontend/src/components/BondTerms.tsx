import type { BondTerms as BondTermsData } from "../lib/read";

export function BondTerms({ terms }: { terms: BondTermsData }) {
  const ratePercent = (Number(terms.rate) / 10 ** terms.rateDecimals).toFixed(2);
  const periodDays = Math.round(
    (Number(terms.endDate) - Number(terms.startDate)) / 86_400,
  );
  const supply = (Number(terms.totalSupply) / 10 ** terms.decimals).toLocaleString();
  const recordDateReached = Number(terms.startDate) * 1000 < Date.now();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Metric label="Coupon rate" value={`${ratePercent}%`} />
      <Metric label="Period" value={`${periodDays}d`} />
      <Metric label="Supply" value={supply} />
      <Metric label="Record date" value={recordDateReached ? "Reached" : "Pending"} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--surface-1)" }}>
      <p className="text-[13px] m-0 mb-1" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <p className="text-2xl font-medium m-0">{value}</p>
    </div>
  );
}
