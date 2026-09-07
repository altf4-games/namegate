// The dashboard's investor list is no longer just the two fixed demo
// addresses from .env.local — anyone onboarded through the app gets
// remembered here too, so the dashboard is a real, growing roster rather
// than a fixed two-card script. Persisted in this browser's localStorage
// only (per-viewer convenience, not shared state — there is no backend of
// its own to share it through). The two seed investors from env always
// come first and can't be removed, since they're the project's known-good
// demo pair.

import { env } from "./env";

export type InvestorEntry = { label: string; address: `0x${string}` };

const STORAGE_KEY = "namegate:investors";

function seedInvestors(): InvestorEntry[] {
  return [
    { label: env.investorALabel, address: env.investorAAddress },
    { label: env.investorBLabel, address: env.investorBAddress },
  ];
}

export function loadInvestors(): InvestorEntry[] {
  const seed = seedInvestors();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const stored = JSON.parse(raw) as InvestorEntry[];
    const seedLabels = new Set(seed.map((i) => i.label));
    return [...seed, ...stored.filter((i) => !seedLabels.has(i.label))];
  } catch {
    // Private browsing, cleared site data, or corrupt JSON — degrade to the
    // seed pair rather than throwing and blanking the whole dashboard.
    return seed;
  }
}

export function saveOnboardedInvestor(entry: InvestorEntry): InvestorEntry[] {
  const seed = seedInvestors();
  const seedLabels = new Set(seed.map((i) => i.label));
  let onboarded: InvestorEntry[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    onboarded = raw ? (JSON.parse(raw) as InvestorEntry[]) : [];
  } catch {
    onboarded = [];
  }
  const next = [...onboarded.filter((i) => i.label !== entry.label), entry];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked — the investor still gets shown for this
    // session via the returned list, it just won't survive a reload.
  }
  return [...seed, ...next.filter((i) => !seedLabels.has(i.label))];
}
