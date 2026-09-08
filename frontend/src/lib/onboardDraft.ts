// Persists the in-progress onboarding form to this browser's localStorage —
// form fields and each step's status/tx hash — so a page reload or a closed
// tab doesn't lose progress. CCIP delivery between step 3 and step 4 can
// take minutes, sometimes much longer; nobody should have to keep a tab
// open and staring at it that whole time. Per-viewer convenience only, same
// as investors.ts — nothing here is shared state.

export type StepStatus = "idle" | "busy" | "done" | "error";
export type StepKey = "register" | "compliance" | "publish" | "issue";

export type OnboardDraft = {
  label: string;
  address: string;
  jurisdiction: string;
  accreditationExpiry: string;
  lockupUntil: string;
  wholeUnits: string;
  steps: Record<StepKey, { status: StepStatus; detail?: string }>;
};

const STORAGE_KEY = "namegate:onboardDraft";

export function loadOnboardDraft(): OnboardDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OnboardDraft) : null;
  } catch {
    return null;
  }
}

export function saveOnboardDraft(draft: OnboardDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or blocked — the draft just won't survive a reload,
    // which is the same as not having this feature at all. Not fatal.
  }
}

export function clearOnboardDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if storage is blocked.
  }
}
