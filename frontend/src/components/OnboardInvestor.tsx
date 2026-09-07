import { useState } from "react";
import { isAddress } from "viem";
import type { MinimalEip1193Provider } from "../lib/actions";
import { publishCompliance } from "../lib/actions";
import { registerInvestor, setComplianceRecords, issueTokens } from "../lib/onboard";

type StepKey = "register" | "compliance" | "publish" | "issue";
type StepState = { status: "idle" | "busy" | "done" | "error"; detail?: string };

const STEP_LABELS: Record<StepKey, string> = {
  register: "1. Register on ENS",
  compliance: "2. Set compliance records",
  publish: "3. Publish to Hedera",
  issue: "4. Issue bond tokens",
};

type Props = {
  connected: boolean;
  connect: () => void;
  getProvider: () => Promise<{ provider: MinimalEip1193Provider; account: `0x${string}` }>;
  onOnboarded: (label: string, address: `0x${string}`) => void;
};

export function OnboardInvestor({ connected, connect, getProvider, onOnboarded }: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [jurisdiction, setJurisdiction] = useState("US");
  const [accreditationExpiry, setAccreditationExpiry] = useState("");
  const [lockupUntil, setLockupUntil] = useState("");
  const [wholeUnits, setWholeUnits] = useState("100");
  const [formError, setFormError] = useState<string | null>(null);

  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    register: { status: "idle" },
    compliance: { status: "idle" },
    publish: { status: "idle" },
    issue: { status: "idle" },
  });

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
    await runStep("issue", () =>
      issueTokens(provider, account, address as `0x${string}`, units),
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full text-[13px]">
        + Onboard a new investor
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border-[0.5px] p-4 flex flex-col gap-3"
      style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
    >
      <div className="flex justify-between items-center">
        <p className="font-medium text-[15px] m-0">Onboard a new investor</p>
        <button onClick={() => setOpen(false)} aria-label="Close" style={{ padding: "4px 8px" }}>
          <i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Label">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="investorc" />
        </Field>
        <Field label="Address">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x..." />
        </Field>
        <Field label="Jurisdiction">
          <input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
        </Field>
        <Field label="Accreditation expiry">
          <input
            type="date"
            value={accreditationExpiry}
            onChange={(e) => setAccreditationExpiry(e.target.value)}
          />
        </Field>
        <Field label="Lockup until (optional)">
          <input type="date" value={lockupUntil} onChange={(e) => setLockupUntil(e.target.value)} />
        </Field>
        <Field label="Tokens to issue">
          <input value={wholeUnits} onChange={(e) => setWholeUnits(e.target.value)} />
        </Field>
      </div>

      {formError && (
        <p className="text-[13px] m-0" style={{ color: "var(--text-danger)" }}>
          {formError}
        </p>
      )}

      <StepRow
        stepKey="register"
        state={steps.register}
        onRun={handleRegister}
        disabled={false}
      />
      <StepRow
        stepKey="compliance"
        state={steps.compliance}
        onRun={handleCompliance}
        disabled={steps.register.status !== "done"}
      />
      <StepRow
        stepKey="publish"
        state={steps.publish}
        onRun={handlePublish}
        disabled={steps.compliance.status !== "done"}
      />
      <StepRow
        stepKey="issue"
        state={steps.issue}
        onRun={handleIssue}
        disabled={steps.publish.status !== "done"}
      />

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
  stepKey,
  state,
  onRun,
  disabled,
}: {
  stepKey: StepKey;
  state: StepState;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[13px] m-0">{STEP_LABELS[stepKey]}</p>
        {state.status === "done" && (
          <p
            className="text-[11px] m-0 truncate"
            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
          >
            {state.detail}
          </p>
        )}
        {state.status === "error" && (
          <p className="text-[11px] m-0" style={{ color: "var(--text-danger)" }}>
            {state.detail}
          </p>
        )}
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
