import { useEffect, useState } from "react";
import { isAddress, getAddress } from "viem";
import type { MinimalEip1193Provider } from "../lib/actions";
import { publishCompliance } from "../lib/actions";
import { registerInvestor, setComplianceRecords, issueTokens } from "../lib/onboard";
import { readMirrorAuthorized } from "../lib/read";
import { loadOnboardDraft, saveOnboardDraft, clearOnboardDraft, type OnboardDraft } from "../lib/onboardDraft";

type StepKey = "register" | "compliance" | "publish" | "issue";
type StepState = { status: "idle" | "busy" | "done" | "error"; detail?: string };

const STEP_LABELS: Record<StepKey, string> = {
  register: "Register on ENS",
  compliance: "Set compliance records",
  publish: "Publish to Hedera",
  issue: "Issue bond tokens",
};

type Props = {
  connected: boolean;
  connect: () => void;
  getProvider: () => Promise<{ provider: MinimalEip1193Provider; account: `0x${string}` }>;
  onOnboarded: (label: string, address: `0x${string}`) => void;
  /** Called once tokens are actually issued — the investor card was already
   * showing since step 1, but its balance and coupon entitlement are only
   * correct as of a fresh read, which nothing else triggers on its own. */
  onIssued: () => void;
};

function inOneYear(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const IDLE_STEPS: Record<StepKey, StepState> = {
  register: { status: "idle" },
  compliance: { status: "idle" },
  publish: { status: "idle" },
  issue: { status: "idle" },
};

// A step reload finds "busy" in can't be trusted — the underlying
// transaction might have gone through, might have failed, might still be
// pending, and there's no way to tell from here. Downgrading it to "idle"
// means the user just sees a normal "Run" button and can safely retry
// (register/publish/issue all simulate before sending, so a genuine
// duplicate gets caught before spending gas, not after).
function sanitizeLoadedSteps(steps: Record<StepKey, StepState>): Record<StepKey, StepState> {
  const result = { ...steps };
  for (const key of Object.keys(result) as StepKey[]) {
    if (result[key].status === "busy") result[key] = { status: "idle" };
  }
  return result;
}

export function OnboardInvestor({ connected, connect, getProvider, onOnboarded, onIssued }: Props) {
  const [draftLoaded] = useState<OnboardDraft | null>(() => loadOnboardDraft());

  const [open, setOpen] = useState(() => draftLoaded !== null);
  const [label, setLabel] = useState(() => draftLoaded?.label ?? "");
  const [address, setAddress] = useState(() => draftLoaded?.address ?? "");
  const [jurisdiction, setJurisdiction] = useState(() => draftLoaded?.jurisdiction ?? "US");
  const [accreditationExpiry, setAccreditationExpiry] = useState(() => draftLoaded?.accreditationExpiry ?? "");
  const [lockupUntil, setLockupUntil] = useState(() => draftLoaded?.lockupUntil ?? "");
  const [wholeUnits, setWholeUnits] = useState(() => draftLoaded?.wholeUnits ?? "100");
  const [formError, setFormError] = useState<string | null>(null);

  const [steps, setSteps] = useState<Record<StepKey, StepState>>(() =>
    draftLoaded ? sanitizeLoadedSteps(draftLoaded.steps) : IDLE_STEPS,
  );

  const started = Object.values(steps).some((s) => s.status !== "idle");

  // Persists the whole in-progress form — fields and step statuses — so a
  // reload or a closed tab (CCIP delivery between step 3 and step 4 can
  // take a long time; nobody should have to babysit a browser tab for that)
  // picks up right where it left off instead of losing everything.
  useEffect(() => {
    if (!started && !label && !address) {
      clearOnboardDraft();
      return;
    }
    saveOnboardDraft({ label, address, jurisdiction, accreditationExpiry, lockupUntil, wholeUnits, steps });
  }, [label, address, jurisdiction, accreditationExpiry, lockupUntil, wholeUnits, steps, started]);

  // Once issued, the investor is already saved in the persistent roster —
  // nothing left for the draft to resume, so stop carrying it forward.
  useEffect(() => {
    if (steps.issue.status === "done") clearOnboardDraft();
  }, [steps.issue.status]);

  // A publish() transaction confirming on Sepolia only proves the CCIP
  // router accepted it — delivery to Hedera takes minutes, and issue()
  // genuinely reverts with AccountIsBlocked until it lands. This polls the
  // real Hedera state so step 4 is only ever offered once it would actually
  // succeed, instead of a button that looks ready but silently isn't.
  const [mirrorAuthorized, setMirrorAuthorized] = useState(false);
  useEffect(() => {
    if (steps.publish.status !== "done" || mirrorAuthorized) return;
    let cancelled = false;
    const check = async () => {
      try {
        const authorized = await readMirrorAuthorized(address as `0x${string}`);
        if (!cancelled && authorized) setMirrorAuthorized(true);
      } catch {
        // Transient RPC hiccup — the next poll tries again.
      }
    };
    check();
    const interval = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [steps.publish.status, address, mirrorAuthorized]);

  function fillDemoValues() {
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    // A genuinely fresh random address each time — reusing a fixed one
    // (this used to always be the burn address) means a second onboarding
    // run can land on an address the mirror already authorized from a
    // PREVIOUS run, silently skipping the real CCIP wait rather than
    // proving it.
    const randomBytes = crypto.getRandomValues(new Uint8Array(20));
    const randomAddress = getAddress(
      `0x${Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("")}`,
    );
    setLabel(`investor${suffix}`);
    setAddress(randomAddress);
    setJurisdiction("US");
    setAccreditationExpiry(inOneYear());
    setLockupUntil("");
    setWholeUnits("100");
    setFormError(null);
  }

  function validate(): boolean {
    if (!label.trim()) return fail("Enter a label, e.g. investorc");
    if (!isAddress(address)) return fail("Enter a valid 0x address");
    if (!accreditationExpiry) return fail("Pick an accreditation expiry date");
    return true;
    function fail(msg: string) {
      setFormError(msg);
      return false;
    }
  }

  async function runStep(key: StepKey, fn: () => Promise<{ txHash: `0x${string}` }>) {
    setSteps((s) => ({ ...s, [key]: { status: "busy" } }));
    try {
      const { txHash } = await fn();
      setSteps((s) => ({ ...s, [key]: { status: "done", detail: txHash } }));
      return true;
    } catch (error) {
      setSteps((s) => ({ ...s, [key]: { status: "error", detail: (error as Error).message } }));
      return false;
    }
  }

  async function handleRegister() {
    setFormError(null);
    if (!validate()) return;
    if (!connected) return connect();
    const { provider, account } = await getProvider();
    const ok = await runStep("register", () =>
      registerInvestor(provider, account, {
        label: label.trim(),
        investorAddress: address as `0x${string}`,
        accreditationExpiry,
      }),
    );
    if (ok) onOnboarded(label.trim(), address as `0x${string}`);
  }

  async function handleCompliance() {
    if (!connected) return connect();
    const { provider, account } = await getProvider();
    await runStep("compliance", () =>
      setComplianceRecords(provider, account, {
        label: label.trim(),
        investorAddress: address as `0x${string}`,
        kyc: "verified",
        jurisdiction,
        accreditationExpiry,
        lockupUntil,
      }),
    );
  }

  async function handlePublish() {
    if (!connected) return connect();
    const { provider, account } = await getProvider();
    await runStep("publish", async () => {
      const result = await publishCompliance(provider, account, label.trim());
      return { txHash: result.txHash };
    });
  }

  async function handleIssue() {
    if (!connected) return connect();
    const units = Number(wholeUnits);
    if (!Number.isFinite(units) || units <= 0) {
      setFormError("Enter a positive number of whole units to issue");
      return;
    }
    const { provider, account } = await getProvider();
    const ok = await runStep("issue", () => issueTokens(provider, account, address as `0x${string}`, units));
    if (ok) onIssued();
  }

  const RUNNERS: Record<StepKey, () => void> = {
    register: handleRegister,
    compliance: handleCompliance,
    publish: handlePublish,
    issue: handleIssue,
  };
  const GATE: Record<StepKey, boolean> = {
    register: false,
    compliance: steps.register.status !== "done",
    publish: steps.compliance.status !== "done",
    issue: steps.publish.status !== "done" || !mirrorAuthorized,
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full text-[13px]">
        + Onboard a new investor
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border-[0.5px] p-4 flex flex-col gap-4"
      style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
    >
      <div className="flex justify-between items-center">
        <div>
          <p className="font-medium text-[15px] m-0">Onboard a new investor</p>
          <p className="text-[12px] m-0 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Four real, sequential transactions from your connected wallet.
          </p>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close" style={{ padding: "4px 8px" }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Field label="Label">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="investorc"
              disabled={started}
            />
          </Field>
          <Field label="Address">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              disabled={started}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <Field label="Jurisdiction">
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              disabled={started}
            />
          </Field>
          <Field label="Accreditation expiry">
            <input
              type="date"
              value={accreditationExpiry}
              onChange={(e) => setAccreditationExpiry(e.target.value)}
              disabled={started}
            />
          </Field>
          <Field label="Lockup until (optional)">
            <input
              type="date"
              value={lockupUntil}
              onChange={(e) => setLockupUntil(e.target.value)}
              disabled={started}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <Field label="Tokens to issue">
            <input value={wholeUnits} onChange={(e) => setWholeUnits(e.target.value)} />
          </Field>
        </div>
        {!started && (
          <button onClick={fillDemoValues} className="self-start text-[12px]">
            Fill demo values
          </button>
        )}
      </div>

      {formError && (
        <p className="text-[13px] m-0" style={{ color: "var(--text-danger)" }}>
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {(Object.keys(STEP_LABELS) as StepKey[]).map((key, i) => (
          <StepRow
            key={key}
            index={i + 1}
            stepKey={key}
            state={steps[key]}
            onRun={RUNNERS[key]}
            disabled={GATE[key]}
          />
        ))}
      </div>

      {steps.publish.status === "done" && !mirrorAuthorized && (
        <p className="text-[12px] m-0 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <i className="ti ti-loader-2" style={{ fontSize: 13 }} aria-hidden="true" />
          Waiting for CCIP delivery to Hedera before issuing is possible — this takes a few minutes, sometimes
          longer. Checking automatically every 10s.
        </p>
      )}

      {steps.issue.status === "done" && (
        <p className="text-[13px] m-0" style={{ color: "var(--text-success)" }}>
          Done — {label} now holds real bond tokens with a fresh, unpaid coupon entitlement.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>
      {label}
      {children}
    </label>
  );
}

function StepRow({
  index,
  stepKey,
  state,
  onRun,
  disabled,
}: {
  index: number;
  stepKey: StepKey;
  state: StepState;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
      style={{ background: "var(--surface-1)" }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <StepBadge index={index} status={state.status} />
        <div className="min-w-0">
          <p className="text-[13px] m-0">{STEP_LABELS[stepKey]}</p>
          {state.status === "done" && state.detail && (
            <a
              href={
                stepKey === "issue"
                  ? `https://hashscan.io/testnet/tx/${state.detail}`
                  : `https://sepolia.etherscan.io/tx/${state.detail}`
              }
              target="_blank"
              rel="noreferrer"
              className="text-[11px] m-0 truncate max-w-[220px] block underline"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
            >
              {state.detail}
            </a>
          )}
          {state.status === "error" && (
            <p className="text-[11px] m-0" style={{ color: "var(--text-danger)" }}>
              {state.detail}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={onRun}
        disabled={disabled || state.status === "busy" || state.status === "done"}
        className="text-[12px] shrink-0"
      >
        {state.status === "busy" ? "Working..." : state.status === "done" ? "Done" : "Run"}
      </button>
    </div>
  );
}

function StepBadge({ index, status }: { index: number; status: StepState["status"] }) {
  const base = "w-6 h-6 rounded-full flex items-center justify-center text-[11px] shrink-0";
  if (status === "done") {
    return (
      <span className={base} style={{ background: "var(--bg-success)", color: "var(--text-success)" }}>
        <i className="ti ti-check" style={{ fontSize: 13 }} aria-hidden="true" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={base} style={{ background: "var(--bg-danger)", color: "var(--text-danger)" }}>
        <i className="ti ti-x" style={{ fontSize: 13 }} aria-hidden="true" />
      </span>
    );
  }
  if (status === "busy") {
    return (
      <span className={base} style={{ background: "var(--bg-accent)", color: "var(--text-accent)" }}>
        <i className="ti ti-loader-2" style={{ fontSize: 13 }} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={base} style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
      {index}
    </span>
  );
}
