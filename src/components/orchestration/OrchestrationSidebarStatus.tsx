"use client";

import {
  orchestrationModeLabel,
  orchestrationPhaseLabel,
} from "@/lib/orchestration/orchestration-labels";
import { useOrchestrationUi, type OrchestrationUiSession } from "./OrchestrationUiContext";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { useStore } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import { RotateCcw, X } from "lucide-react";

function OrchestrationSessionBlock({
  session,
  topicId,
  onRetry,
  onDismiss,
  compact = false,
}: {
  session: OrchestrationUiSession;
  topicId?: string;
  onRetry: (employeeId: string) => void;
  onDismiss?: (orchestrationId: string) => void;
  compact?: boolean;
}) {
  const { state } = useStore();

  if (!session.orchestrationPlan?.shouldRespond || !session.employees.length) {
    return null;
  }

  const modeLabel = orchestrationModeLabel(
    session.orchestrationPlan,
    session.collaborationPlan?.mode ?? null,
  );
  const hasFailed = session.employees.some((e) => e.phase === "failed");
  const isSocialBroadcast = session.orchestrationPlan.intent === "social_broadcast";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/40 p-2.5",
        compact && "bg-muted/25",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
          {session.completed ? "Recent orchestration" : "Active orchestration"}
        </div>
        {onDismiss && session.orchestrationId && isSocialBroadcast && session.completed && (
          <button
            type="button"
            onClick={() => onDismiss(session.orchestrationId!)}
            className="rounded p-0.5 text-ink-3 hover:bg-muted hover:text-ink"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        )}
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
            <li key={`${session.orchestrationId}-${entry.employeeId}`} className="flex items-start gap-2">
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
                {entry.phase === "failed" && entry.runId && !session.completed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-6 gap-1 px-1.5 text-[10px] text-rose-700"
                    onClick={() => onRetry(entry.employeeId)}
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
      {topicId && session.createdAt && compact && (
        <p className="mt-1 text-[9px] text-ink-3">
          {new Date(session.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}

export function OrchestrationSidebarStatus({ topicId }: { topicId?: string }) {
  const { session, historySessions, retryFailedRun, dismissHistorySession } =
    useOrchestrationUi();

  const hasActive =
    session.orchestrationPlan?.shouldRespond && session.employees.length > 0;
  const visibleHistory = historySessions.filter(
    (entry) => entry.orchestrationId !== session.orchestrationId,
  );

  if (!hasActive && visibleHistory.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {hasActive && (
        <OrchestrationSessionBlock
          session={session}
          topicId={topicId}
          onRetry={(employeeId) => void retryFailedRun(employeeId)}
        />
      )}
      {visibleHistory.map((historySession) => (
        <OrchestrationSessionBlock
          key={historySession.orchestrationId ?? historySession.triggerMessageId}
          session={historySession}
          topicId={topicId}
          compact
          onRetry={(employeeId) => void retryFailedRun(employeeId)}
          onDismiss={
            topicId && historySession.orchestrationId
              ? (id) => dismissHistorySession(id, topicId)
              : undefined
          }
        />
      ))}
    </div>
  );
}
