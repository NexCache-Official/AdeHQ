import type { PlaybookRunStatus, PlaybookStepStatus } from "./contracts";

const RUN_TRANSITIONS: Record<PlaybookRunStatus, readonly PlaybookRunStatus[]> = {
  draft: ["awaiting_input", "estimating", "queued", "cancelled"],
  awaiting_input: ["estimating", "awaiting_approval", "queued", "cancelled"],
  estimating: ["awaiting_approval", "queued", "running", "failed", "cancelled"],
  awaiting_approval: ["queued", "cancelled", "failed"],
  queued: ["running", "cancelled", "failed"],
  running: ["blocked", "reviewing", "rendering", "completed", "failed", "cancelled"],
  blocked: ["running", "awaiting_approval", "failed", "cancelled"],
  reviewing: ["running", "rendering", "completed", "failed", "cancelled"],
  rendering: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const STEP_TRANSITIONS: Record<PlaybookStepStatus, readonly PlaybookStepStatus[]> = {
  pending: ["ready", "skipped", "cancelled"],
  ready: ["leased", "running", "awaiting_approval", "skipped", "cancelled"],
  leased: ["running", "awaiting_approval", "failed", "cancelled"],
  running: ["awaiting_approval", "completed", "failed", "cancelled"],
  awaiting_approval: ["running", "completed", "failed", "cancelled", "skipped"],
  completed: [],
  failed: [],
  cancelled: [],
  skipped: [],
};

export function canTransitionPlaybookRun(
  from: PlaybookRunStatus,
  to: PlaybookRunStatus,
): boolean {
  if (from === to) return true;
  return (RUN_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionPlaybookStep(
  from: PlaybookStepStatus,
  to: PlaybookStepStatus,
): boolean {
  if (from === to) return true;
  return (STEP_TRANSITIONS[from] ?? []).includes(to);
}

export function assertPlaybookRunTransition(
  from: PlaybookRunStatus,
  to: PlaybookRunStatus,
): void {
  if (!canTransitionPlaybookRun(from, to)) {
    throw new Error(`Invalid playbook run transition: ${from} → ${to}`);
  }
}

export function assertPlaybookStepTransition(
  from: PlaybookStepStatus,
  to: PlaybookStepStatus,
): void {
  if (!canTransitionPlaybookStep(from, to)) {
    throw new Error(`Invalid playbook step transition: ${from} → ${to}`);
  }
}

export function isTerminalPlaybookRunStatus(status: PlaybookRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isTerminalPlaybookStepStatus(status: PlaybookStepStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "skipped"
  );
}

export function allowedPlaybookRunTransitions(
  from: PlaybookRunStatus,
): readonly PlaybookRunStatus[] {
  return RUN_TRANSITIONS[from] ?? [];
}

export function allowedPlaybookStepTransitions(
  from: PlaybookStepStatus,
): readonly PlaybookStepStatus[] {
  return STEP_TRANSITIONS[from] ?? [];
}
