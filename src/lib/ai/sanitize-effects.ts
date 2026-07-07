import type { EmployeeResponse } from "@/lib/ai/types";
import { getWorkLogVisibility } from "@/lib/work-log-labels";

const DROP_WORKLOG_ACTIONS = new Set([
  "greeting",
  "read_context",
  "none needed",
  "structured output fallback",
  "model fallback",
  "model error",
  "orchestration_completed",
  "topic_suggested",
  "topic_summary_refreshed",
  "topic_memory_suggested",
  "next_actions_suggested",
  "memory_suggested",
  "acknowledged_instruction",
  "acknowledged_task_assignment",
  "queued_run",
  "processed_run",
  "run_completed",
  "run_queued",
  "panel_response_completed",
]);

const DROP_WORKLOG_SUMMARY = [
  /^reviewed topic messages/i,
  /^read context/i,
  /^greeting/i,
  /^structured output fallback/i,
  /^returned natural language reply/i,
  /^completed orchestration/i,
  /^refreshed topic summary/i,
  /^suggested topic/i,
  /^suggested next actions/i,
  /^acknowledged/i,
  /^noted\b/i,
  /^will do\b/i,
];

function shouldDropWorkLogEntry(
  entry: EmployeeResponse["effect"]["workLog"][number],
): boolean {
  const action = (entry.action ?? "").trim().toLowerCase();
  const summary = (entry.summary ?? "").trim();
  if (!action && !summary) return true;
  if (DROP_WORKLOG_ACTIONS.has(action)) return true;
  if (action === "none" || action === "none needed") return true;
  if (getWorkLogVisibility(action, summary) !== "user_work_log") return true;
  return DROP_WORKLOG_SUMMARY.some((p) => p.test(summary));
}

export type SanitizeEffectsOptions = {
  isGreetingRun?: boolean;
  stripAllEffects?: boolean;
};

export function sanitizeEffects(
  effect: EmployeeResponse["effect"],
  options: SanitizeEffectsOptions = {},
): EmployeeResponse["effect"] {
  if (options.isGreetingRun || options.stripAllEffects) {
    return {
      workLog: [],
      tasks: [],
      memory: [],
      approvals: [],
      emailDrafts: [],
      citations: [],
      artifacts: [],
      memorySuggestions: [],
      toolCalls: [],
      statusChange: effect.statusChange,
      handoffTo: effect.handoffTo,
      currentTask: effect.currentTask,
    };
  }

  return {
    ...effect,
    workLog: effect.workLog.filter((entry) => !shouldDropWorkLogEntry(entry)),
  };
}
