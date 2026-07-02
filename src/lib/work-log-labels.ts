const ACTION_LABELS: Record<string, string> = {
  draft_cold_email: "drafted cold email",
  reviewed_email_draft: "reviewed email draft",
  reviewed_cold_email_draft: "reviewed cold email draft",
  panel_response_completed: "completed panel review",
  collaboration_completed: "completed collaboration",
  handoff_completed: "completed handoff",
  orchestration_completed: "completed orchestration",
  topic_suggested: "suggested a topic",
  topic_created: "created a topic",
  messages_moved: "moved messages",
  topic_summary_refreshed: "refreshed topic summary",
  topic_summary_saved_to_memory: "saved topic summary to memory",
  topic_memory_suggested: "suggested topic memory",
  next_actions_suggested: "suggested next actions",
  memory_saved: "saved to memory",
  task_suggested: "suggested a task",
  memory_suggested: "suggested saving to memory",
  read_context: "read context",
  model_error: "hit a model error",
  model_fallback: "used fallback response",
};

function titleCaseWords(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Human-readable verb phrase from a work log action slug. */
export function humanizeWorkLogAction(action: string): string {
  const key = action.trim().toLowerCase().replace(/\s+/g, "_");
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(key)) {
    return key.replace(/_/g, " ");
  }
  return action.toLowerCase();
}

/** Display line: "Sales Employee drafted cold email" */
export function formatWorkLogTitle(employeeName: string | undefined, action: string): string {
  const verb = humanizeWorkLogAction(action);
  const name = employeeName?.trim() || "AI employee";
  return `${name} ${verb}`;
}

/** System-generated work log actions hidden from DM activity feeds. */
const DM_HIDDEN_WORK_LOG_ACTIONS = new Set([
  "orchestration_completed",
  "panel_response_completed",
  "collaboration_completed",
  "handoff_completed",
  "topic_suggested",
  "topic_summary_refreshed",
  "topic_memory_suggested",
  "next_actions_suggested",
  "memory_suggested",
]);

/** Skip noisy or non-work entries in compact sidebars. */
export function shouldShowWorkLogInSidebar(action: string, summary?: string): boolean {
  const key = action.trim().toLowerCase();
  if (key === "read_context") return false;
  if (key === "model fallback" || key === "model error") return false;
  if (/^greet/i.test(summary ?? "") || /^greet/i.test(action)) return false;
  return true;
}

export function shouldShowWorkLogInTopic(
  action: string,
  summary?: string,
  opts?: { isDm?: boolean },
): boolean {
  if (!shouldShowWorkLogInSidebar(action, summary)) return false;
  if (!opts?.isDm) return true;
  const key = action.trim().toLowerCase().replace(/\s+/g, "_");
  return !DM_HIDDEN_WORK_LOG_ACTIONS.has(key);
}
