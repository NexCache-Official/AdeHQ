import type { PlaybookRunStatus, PlaybookStepStatus } from "./contracts";

/** When true, no further downstream steps should be leased/started. */
export function shouldStopDownstream(runStatus: PlaybookRunStatus): boolean {
  return (
    runStatus === "cancelled" ||
    runStatus === "failed" ||
    runStatus === "completed"
  );
}

/** Statuses to apply to non-terminal steps when a run is cancelled. */
export function cancelledStepStatuses(): {
  forPending: PlaybookStepStatus;
  forReady: PlaybookStepStatus;
  forRunning: PlaybookStepStatus;
} {
  return {
    forPending: "cancelled",
    forReady: "cancelled",
    forRunning: "cancelled",
  };
}

export function isCancellableRunStatus(status: PlaybookRunStatus): boolean {
  return (
    status === "draft" ||
    status === "awaiting_input" ||
    status === "estimating" ||
    status === "awaiting_approval" ||
    status === "queued" ||
    status === "running" ||
    status === "blocked" ||
    status === "reviewing" ||
    status === "rendering"
  );
}
