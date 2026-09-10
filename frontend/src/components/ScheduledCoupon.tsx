import { useEffect, useRef, useState } from "react";
import type { InvestorView } from "../lib/read";
import { env } from "../lib/env";
import { shortenAddress } from "../lib/format";

// Creating the schedule needs Hedera's native gRPC SDK, which can't run in a
// browser, so it goes through /api/schedule-coupon (the issuer's operator
// key stays server-side). Reading the schedule's status back is plain HTTP
// against the mirror node, so that half stays client-side.

type ScheduleResult = { scheduleId: string; expiresAt: string };
type Phase =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "waiting"; result: ScheduleResult }
  | { kind: "executed"; result: ScheduleResult; at: string }
  | { kind: "error"; message: string };

const DELAY_SECONDS = 60;

export function ScheduledCoupon({
  investors,
  connected,
  connect,
}: {
  investors: InvestorView[];
  connected: boolean;
  connect: () => void;
}) {
  const [holder, setHolder] = useState<`0x${string}`>(investors[0]?.address ?? ("0x" as `0x${string}`));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function schedule() {
    setPhase({ kind: "creating" });
    try {
      const response = await fetch("/api/schedule-coupon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holder,
          couponId: Number(env.couponId),
          secondsFromNow: DELAY_SECONDS,
        }),
      });
      const json = (await response.json()) as ScheduleResult & { error?: string };
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);

      const result: ScheduleResult = { scheduleId: json.scheduleId, expiresAt: json.expiresAt };
      setPhase({ kind: "waiting", result });

      pollTimer.current = setInterval(async () => {
        try {
          const mirror = await fetch(
            `https://testnet.mirrornode.hedera.com/api/v1/schedules/${result.scheduleId}`,
          );
          if (!mirror.ok) return;
          const record = (await mirror.json()) as { executed_timestamp: string | null };
          if (record.executed_timestamp) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setPhase({ kind: "executed", result, at: record.executed_timestamp });
          }
        } catch {
          // Transient mirror-node hiccup — keep polling.
        }
      }, 5000);
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div>
      <p className="text-[13px] m-0 mb-2" style={{ color: "var(--text-secondary)" }}>
        Schedule a coupon payout
      </p>
      <div
        className="rounded-xl border-[0.5px] p-4 flex flex-col gap-3"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
      >
        <p className="text-[12px] m-0" style={{ color: "var(--text-secondary)" }}>
          Wraps <code className="font-mono">CouponDistributor.distribute()</code> in a Hedera
          <code className="font-mono"> ScheduleCreateTransaction</code> with{" "}
          <code className="font-mono">waitForExpiry</code>, so it settles on its own {DELAY_SECONDS}s
          from now with no further action.
        </p>

        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={holder}
            onChange={(e) => setHolder(e.target.value as `0x${string}`)}
            disabled={phase.kind === "creating" || phase.kind === "waiting"}
            className="text-[13px] rounded-md px-2 py-1.5"
            style={{ background: "var(--surface-1)", color: "var(--text-primary)", border: "0.5px solid var(--border)" }}
          >
            {investors.map((i) => (
              <option key={i.address} value={i.address}>
                {i.label}.namegate.eth ({shortenAddress(i.address)})
              </option>
            ))}
          </select>
          <button
            onClick={connected ? schedule : connect}
            disabled={phase.kind === "creating" || phase.kind === "waiting"}
            className="text-[13px]"
          >
            {!connected
              ? "Connect wallet to schedule"
              : phase.kind === "creating"
                ? "Scheduling..."
                : phase.kind === "waiting"
                  ? "Waiting for execution..."
                  : `Schedule (+${DELAY_SECONDS}s)`}
          </button>
        </div>

        {phase.kind === "waiting" && (
          <p className="text-[12px] m-0" style={{ color: "var(--text-secondary)" }}>
            Schedule <span className="font-mono">{phase.result.scheduleId}</span> created. It has{" "}
            <strong>not</strong> executed yet — Hedera holds it until{" "}
            {new Date(phase.result.expiresAt).toLocaleTimeString()}.
          </p>
        )}

        {phase.kind === "executed" && (
          <p className="text-[12px] m-0" style={{ color: "var(--text-success)" }}>
            Executed at consensus timestamp <span className="font-mono">{phase.at}</span>. The coupon
            paid out with no one calling distribute() by hand.{" "}
            <a
              href={`https://hashscan.io/testnet/schedule/${phase.result.scheduleId}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit" }}
            >
              View on HashScan &rarr;
            </a>
          </p>
        )}

        {phase.kind === "error" && (
          <p className="text-[12px] m-0" style={{ color: "var(--text-danger)" }}>
            {phase.message}
          </p>
        )}
      </div>
    </div>
  );
}
