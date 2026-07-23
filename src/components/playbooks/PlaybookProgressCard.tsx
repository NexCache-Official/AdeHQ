"use client";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Loader2, StopCircle, CheckCircle2, XCircle, Circle } from "lucide-react";

export type PlaybookProgressStep = {
  stepKey: string;
  status: string;
  estimatedWh?: number | null;
  actualWh?: number | null;
  label?: string;
};

export type PlaybookProgressCardProps = {
  playbookName: string;
  status: string;
  steps: PlaybookProgressStep[];
  actualWh?: number | null;
  estimatedWhMin?: number | null;
  estimatedWhMax?: number | null;
  onStop?: () => void;
  stopping?: boolean;
  className?: string;
  compact?: boolean;
};

function stepIcon(status: string) {
  if (status === "completed" || status === "skipped") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green" />;
  }
  if (status === "failed" || status === "cancelled") {
    return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
  }
  if (status === "running" || status === "leased") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />;
  }
  return <Circle className="h-3.5 w-3.5 text-ink-3" />;
}

export function PlaybookProgressCard({
  playbookName,
  status,
  steps,
  actualWh,
  estimatedWhMin,
  estimatedWhMax,
  onStop,
  stopping,
  className,
  compact,
}: PlaybookProgressCardProps) {
  const completed = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const total = steps.length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const canStop =
    onStop &&
    !["completed", "failed", "cancelled"].includes(status);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-panel p-4 shadow-sm",
        compact && "p-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{playbookName}</p>
          <p className="mt-0.5 text-xs capitalize text-ink-3">
            {status.replace(/_/g, " ")} · {completed}/{total} steps · {pct}%
          </p>
        </div>
        {canStop && (
          <Button size="sm" variant="ghost" onClick={onStop} disabled={stopping}>
            {stopping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <StopCircle className="h-3.5 w-3.5" />
            )}
            Stop
          </Button>
        )}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border-2">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
        <span>
          WH used:{" "}
          <span className="font-mono text-ink-2">{Number(actualWh ?? 0).toFixed(2)}</span>
        </span>
        {(estimatedWhMin != null || estimatedWhMax != null) && (
          <span>
            Est:{" "}
            <span className="font-mono text-ink-2">
              {estimatedWhMin ?? "—"}–{estimatedWhMax ?? "—"}
            </span>
          </span>
        )}
      </div>

      {!compact && (
        <ul className="mt-3 space-y-1.5">
          {steps.map((step) => (
            <li
              key={step.stepKey}
              className="flex min-w-0 items-center gap-2 text-xs text-ink-2"
            >
              {stepIcon(step.status)}
              <span className="min-w-0 flex-1 truncate">
                {step.label ?? step.stepKey.replace(/_/g, " ")}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-3">
                {Number(step.actualWh ?? 0).toFixed(2)} WH
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
