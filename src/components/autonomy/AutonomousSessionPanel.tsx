"use client";

/**
 * Autonomous session panel — the live "watch it work" surface. Polls the
 * session while active, streams the step timeline, shows budget usage, and
 * exposes Stop / Pause / Resume. Reused by the Tasks trigger and chat.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTONOMY_ACTIVE_STATUSES,
  controlAutonomousSession,
  pollAutonomousSession,
  type SessionPayload,
} from "@/lib/autonomy/client";
import type { AutonomousSessionStatus, AutonomousSessionStep } from "@/lib/autonomy/types";
import { StatusPill, ProgressMeter, type Tone } from "@/components/workspace/WorkspaceKit";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  Bot,
  Brain,
  CheckCircle2,
  CircleSlash,
  Flag,
  Loader2,
  Pause,
  Play,
  ShieldAlert,
  Square,
  Wrench,
} from "lucide-react";

const STATUS_TONE: Record<AutonomousSessionStatus, Tone> = {
  queued: "slate",
  planning: "sky",
  running: "sky",
  waiting_approval: "amber",
  paused: "amber",
  completed: "emerald",
  failed: "rose",
  stopped: "slate",
};

const STATUS_LABEL: Record<AutonomousSessionStatus, string> = {
  queued: "Queued",
  planning: "Planning",
  running: "Working",
  waiting_approval: "Needs approval",
  paused: "Paused",
  completed: "Completed",
  failed: "Blocked",
  stopped: "Stopped",
};

const STEP_ICON: Record<AutonomousSessionStep["kind"], typeof Brain> = {
  plan: Flag,
  thought: Brain,
  tool_call: Wrench,
  observation: CheckCircle2,
  approval: ShieldAlert,
  report: CheckCircle2,
  error: CircleSlash,
  status: CircleSlash,
};

export function AutonomousSessionPanel({
  sessionId,
  initial,
  onClose,
  compact = false,
}: {
  sessionId: string;
  initial?: SessionPayload;
  onClose?: () => void;
  compact?: boolean;
}) {
  const [payload, setPayload] = useState<SessionPayload | null>(initial ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepsEndRef = useRef<HTMLDivElement | null>(null);

  const active = payload ? AUTONOMY_ACTIVE_STATUSES.has(payload.session.status) : true;

  const poll = useCallback(async () => {
    try {
      const next = await pollAutonomousSession(sessionId);
      setPayload(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lost connection to the session.");
    }
  }, [sessionId]);

  // Poll every 1.6s while the session is active.
  useEffect(() => {
    if (!active) return;
    timer.current = setTimeout(() => void poll(), 1600);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [active, poll, payload]);

  // Kick an immediate poll on mount if we have no data yet.
  useEffect(() => { if (!payload) void poll(); }, [payload, poll]);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [payload?.steps.length]);

  const control = async (action: "stop" | "pause" | "resume") => {
    setBusy(action);
    try {
      setPayload(await controlAutonomousSession(sessionId, action));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  if (!payload) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Starting autopilot…
      </div>
    );
  }

  const { session, steps } = payload;
  const tone = STATUS_TONE[session.status];
  const stepPct = session.stepBudget ? Math.round((session.stepsUsed / session.stepBudget) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      {/* Header */}
      <div
        className={cn(
          "flex items-start justify-between gap-3 border-b border-border bg-gradient-to-r to-transparent px-4 py-3",
          session.status === "completed"
            ? "from-emerald-500/[0.08]"
            : session.status === "failed"
              ? "from-rose-500/[0.08]"
              : session.status === "waiting_approval" || session.status === "paused"
                ? "from-amber-500/[0.08]"
                : "from-accent-500/[0.08]",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className={cn("mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent", active && "animate-pulse")}>
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">Autopilot</span>
              <StatusPill tone={tone} label={STATUS_LABEL[session.status]} />
            </div>
            <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-ink-2">{session.objective}</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-ink-3 transition-colors hover:text-ink" aria-label="Close">
            ✕
          </button>
        )}
      </div>

      {/* Budget */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
        <span className="text-[11px] font-medium text-ink-3">Steps {session.stepsUsed}/{session.stepBudget}</span>
        <ProgressMeter value={stepPct} tone={tone} className="flex-1" height="h-1.5" />
      </div>

      {/* Timeline */}
      <div className={cn("space-y-0 overflow-y-auto px-4 py-3", compact ? "max-h-64" : "max-h-96")}>
        {steps.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-3">Warming up…</p>
        ) : (
          steps.map((step, i) => <StepRow key={step.id} step={step} last={i === steps.length - 1} />)
        )}
        <div ref={stepsEndRef} />
      </div>

      {/* Report */}
      {session.resultSummary && !active && (
        <div className={cn("border-t border-border px-4 py-3 text-sm", session.status === "failed" ? "bg-rose-500/5 text-rose-700" : "bg-emerald-500/5 text-ink-2")}>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            <Flag className="h-3 w-3" /> Report
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">{session.resultSummary}</p>
        </div>
      )}

      {error && <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div>}

      {/* Controls */}
      {active && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          {session.status === "waiting_approval" ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-700">
              <ShieldAlert className="h-3.5 w-3.5" /> Approve the pending request to continue →
            </span>
          ) : session.status === "paused" ? (
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => control("resume")}>
              {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Resume
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => control("pause")}>
              {busy === "pause" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />} Pause
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" disabled={busy !== null} onClick={() => control("stop")}>
            {busy === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Stop
          </Button>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-3">
            <Loader2 className="h-3 w-3 animate-spin" /> live
          </span>
        </div>
      )}
    </div>
  );
}

function StepRow({ step, last }: { step: AutonomousSessionStep; last: boolean }) {
  const Icon = STEP_ICON[step.kind] ?? Brain;
  const tone =
    step.status === "failed" || step.kind === "error"
      ? "text-rose-600 bg-rose-500/10"
      : step.kind === "approval"
        ? "text-amber-700 bg-amber-500/10"
        : step.kind === "tool_call"
          ? "text-violet-600 bg-violet-500/10"
          : step.kind === "report"
            ? "text-emerald-600 bg-emerald-500/10"
            : step.kind === "plan"
              ? "text-accent bg-accent-soft"
              : "text-ink-3 bg-ink/5";
  const running = step.status === "running" || step.status === "pending";
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", tone)}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
        </span>
        {!last && <span className="my-0.5 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-3")}>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">{step.title}</span>
          {step.toolName && step.kind === "tool_call" && (
            <span className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[10px] text-ink-3">{step.toolName}</span>
          )}
        </div>
        {step.detail && <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{step.detail}</p>}
      </div>
    </div>
  );
}
