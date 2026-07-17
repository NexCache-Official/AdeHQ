"use client";

import type { StewardProgressSnapshot } from "@/lib/brain/steward/types-execution";
import {
  formatCoordinationLine,
  formatStepLine,
} from "@/lib/brain/steward/progress";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";

export function StewardProgressCard({
  progress,
  className,
}: {
  progress: StewardProgressSnapshot;
  className?: string;
}) {
  if (progress.mode === "single_employee" && progress.steps.length <= 1) return null;

  return (
    <div
      className={cn(
        "mx-auto mb-2 max-w-[920px] rounded-xl border border-border bg-surface-1 px-3 py-2.5 text-xs text-ink-2",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-ink">
        <Users className="h-3.5 w-3.5 text-accent-600" />
        {progress.status === "waiting_for_approval"
          ? "Approval needed"
          : progress.status === "completed"
            ? "Collaboration complete"
            : progress.status === "cancelled"
              ? "Collaboration cancelled"
              : `${progress.leadEmployeeName ?? "Lead"} is coordinating this work`}
      </div>
      {progress.status !== "waiting_for_approval" && (
        <p className="mb-2 text-ink-3">{formatCoordinationLine(progress)}</p>
      )}
      {progress.status === "waiting_for_approval" && (
        <p className="mb-2 text-ink-3">
          Proposed workflow uses up to {progress.estimatedWhMax.toFixed(1)} Work Hours.
        </p>
      )}
      <ul className="space-y-1">
        {progress.steps.map((step) => (
          <li key={step.stepId}>{formatStepLine(step)}</li>
        ))}
      </ul>
      {progress.failureMessage ? (
        <p className="mt-2 text-amber-800">{progress.failureMessage}</p>
      ) : null}
      {progress.status === "completed" && progress.actualWh > 0 ? (
        <p className="mt-2 tabular-nums text-ink-3">
          Used {progress.actualWh.toFixed(1)} Work Hours ·{" "}
          {new Set(progress.steps.map((s) => s.employeeId)).size} employees collaborated
        </p>
      ) : null}
    </div>
  );
}
