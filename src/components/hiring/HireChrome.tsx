"use client";

import {
  MAYA_EMPLOYEE_NAME,
} from "@/lib/hiring/maya";
import { cn } from "@/lib/utils";
import type { HiringStep } from "@/lib/hiring/types";
import { ArrowLeft } from "lucide-react";

export function HireExitConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Leave and clear session",
  cancelLabel = "Keep hiring",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/35 px-5 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hire-exit-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-[0_24px_80px_-32px_rgba(17,17,19,0.45)]"
      >
        <h2 id="hire-exit-title" className="text-lg font-semibold tracking-tight text-ink">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink-2 hover:border-ink/30 hover:text-ink disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Clearing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HireHeader({
  onBack,
  backLabel,
  onGoToWorkspace,
}: {
  onBack?: () => void;
  backLabel?: string;
  onGoToWorkspace?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-canvas/90 px-6 py-3.5 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink-2 transition hover:border-ink/30 hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel ?? "Back"}
          </button>
        )}
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-ink text-sm font-bold text-white">
          A
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-ink">AdeHQ</span>
          <span className="text-ink-3">/</span>
          <span className="truncate text-sm text-ink-2">Hire an AI employee</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        {onGoToWorkspace && (
          <button
            type="button"
            onClick={onGoToWorkspace}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:border-ink/30 hover:text-ink"
          >
            Go to workspace
          </button>
        )}
        <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3 shadow-sm">
          <div className="relative h-6 w-6 rounded-full bg-gradient-to-br from-emerald-400 to-sky-500">
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green ring-2 ring-surface" />
          </div>
          <span className="text-[13px] font-medium text-ink-2">{MAYA_EMPLOYEE_NAME}</span>
        </div>
      </div>
    </header>
  );
}

export function HireStepper({
  step,
  recruiterTurns,
}: {
  step: HiringStep;
  recruiterTurns: number;
}) {
  const labels = ["Role", "Context", "Style", "Job Brief", "Applicants"];
  let active = 0;
  if (step === "role") active = 0;
  else if (step === "recruiter") active = Math.min(1 + Math.floor(recruiterTurns / 2), 2);
  else if (step === "brief") active = 3;
  else if (["generating_applicants", "shortlist", "offer"].includes(step)) active = 4;

  if (["success", "assign_optional"].includes(step)) return null;

  return (
    <div className="flex justify-center px-5 pb-1 pt-4">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {labels.map((label, i) => {
          const done = i < active;
          const on = i === active;
          return (
            <div key={label} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold",
                  done || on ? "bg-ink text-white" : "bg-muted text-ink-3",
                )}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                className={cn(
                  "text-[12.5px]",
                  on ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3",
                )}
              >
                {label}
              </span>
              {i < labels.length - 1 && <div className="mx-1 h-px w-[26px] bg-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdeOrb({
  grad,
  size = 32,
  initials,
}: {
  grad?: string;
  size?: number;
  initials?: string;
}) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center font-semibold text-white shadow-[0_6px_18px_-6px_rgba(34,31,26,0.4),inset_0_1px_1px_rgba(255,255,255,0.3)]"
      style={{
        width: size,
        height: size,
        borderRadius: size >= 64 ? 20 : 9999,
        background: grad ?? "linear-gradient(135deg,#34d399,#0ea5e9)",
        fontSize: size >= 60 ? 21 : size >= 40 ? 14 : 12,
      }}
    >
      {initials && <span className="relative z-[1]">{initials}</span>}
    </div>
  );
}

export function MetricDots({ level }: { level: number }) {
  return (
    <div className="flex flex-1 gap-1">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn("h-[5px] flex-1 rounded-sm", i <= level ? "bg-ink" : "bg-ink/10")}
        />
      ))}
    </div>
  );
}
