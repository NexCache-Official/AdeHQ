"use client";

import {
  orchestrationModeLabel,
  orchestrationPhaseLabel,
} from "@/lib/orchestration/orchestration-labels";
import { useOrchestrationUi } from "./OrchestrationUiContext";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { useStore } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import { RotateCcw } from "lucide-react";

export function OrchestrationSidebarStatus() {
  const { session, retryFailedRun } = useOrchestrationUi();
  const { state } = useStore();

  if (!session.orchestrationPlan?.shouldRespond || !session.employees.length) {
    return null;
  }

  const modeLabel = orchestrationModeLabel(
    session.orchestrationPlan,
    session.collaborationPlan?.mode ?? null,
  );

  const hasFailed = session.employees.some((e) => e.phase === "failed");

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        {session.completed ? "Recent orchestration" : "Active orchestration"}
      </div>
      {modeLabel && (
        <div className="mt-1 text-xs font-medium text-ink">{modeLabel}</div>
      )}
      <ul className="mt-2 space-y-2">
        {session.employees.map((entry) => {
          const employee = state.employees.find((e) => e.id === entry.employeeId);
          const phase = orchestrationPhaseLabel(entry.phase, entry.waitingOnEmployeeName);
          const isActive = entry.phase === "reading" || entry.phase === "replying";
          return (
            <li key={entry.employeeId} className="flex items-start gap-2">
              {employee ? (
                <EmployeeAvatar employee={employee} size="xs" showStatus={false} />
              ) : (
                <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-muted" />
              )}
              <div className="min-w-0 flex-1 text-[11px] leading-snug text-ink-2">
                <span className="font-medium text-ink">{entry.employeeName}</span>
                <span className="text-ink-3"> — {entry.role}</span>
                <span
                  className={cn(
                    "ml-1",
                    entry.phase === "completed" && "text-emerald-700",
                    entry.phase === "failed" && "text-rose-600",
                    isActive && "text-accent-700",
                  )}
                >
                  · {phase}
                </span>
                {entry.detail && (
                  <p className="mt-0.5 text-[10px] text-ink-3">{entry.detail}</p>
                )}
                {entry.phase === "failed" && entry.runId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-6 gap-1 px-1.5 text-[10px] text-rose-700"
                    onClick={() => void retryFailedRun(entry.employeeId)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {session.completed && !hasFailed && (
        <p className="mt-2 text-[10px] font-medium text-emerald-700">Completed</p>
      )}
    </div>
  );
}
