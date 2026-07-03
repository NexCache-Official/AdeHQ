const ACTION_LABELS: Record<string, string> = {
  draft_cold_email: "drafted cold email",
  reviewed_email_draft: "reviewed email draft",
  reviewed_cold_email_draft: "reviewed cold email draft",
  coordinated_team_response: "coordinated team response",
  accepted_research_ownership: "accepted market research ownership",
  drafted_sales_outreach_plan: "drafted sales outreach plan",
  requested_market_clarification: "requested market clarification",
  prepared_research_plan: "prepared research plan",
  generated_business_brief: "generated business brief",
  panel_response_completed: "completed panel review",
  collaboration_completed: "coordinated team response",
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
  uploaded_file: "uploaded file",
  processed_file: "processed file",
  file_processing_failed: "could not process file",
  created_artifact: "created artifact",
  saved_artifact: "saved artifact",
  saved_artifact_to_memory: "saved artifact to memory",
  answered_question_about_file: "answered a question about a file",
  generated_artifact: "generated artifact",
  created_prd: "created PRD",
  created_report: "created report",
  created_brief: "created brief",
  suggested_memory_from_file: "suggested memory from file",
  saved_file_memory: "saved file memory",
  read_context: "read context",
  model_error: "hit a model error",
  model_fallback: "used fallback response",
  repeated_message_with_mention: "repeated message with mention after request",
  acknowledged_instruction: "acknowledged instruction",
};

/** Internal orchestration / plumbing — hidden from user-facing Work Log. */
const SYSTEM_WORK_LOG_ACTIONS = new Set([
  "orchestration_completed",
  "topic_suggested",
  "topic_summary_refreshed",
  "topic_memory_suggested",
  "next_actions_suggested",
  "memory_suggested",
  "read_context",
  "queued_run",
  "processed_run",
  "run_completed",
  "run_queued",
  "acknowledged_instruction",
  "acknowledged_task_assignment",
  "panel_response_completed",
]);

/** Debug-only noise — hidden everywhere except debug tooling. */
const DEBUG_WORK_LOG_ACTIONS = new Set([
  "model_error",
  "model_fallback",
  "repeated_message_with_mention",
]);

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

export type WorkLogVisibility = "user_work_log" | "system_activity" | "debug_run_log";

export function getWorkLogVisibility(action: string, summary?: string): WorkLogVisibility {
  const key = action.trim().toLowerCase().replace(/\s+/g, "_");
  if (DEBUG_WORK_LOG_ACTIONS.has(key)) return "debug_run_log";
  if (SYSTEM_WORK_LOG_ACTIONS.has(key)) return "system_activity";
  if (/^greet/i.test(summary ?? "") || /^greet/i.test(action)) return "system_activity";
  if (/^noted\b/i.test(summary ?? "")) return "system_activity";
  if (/^will do\b/i.test(summary ?? "")) return "system_activity";
  if (/orchestration/i.test(summary ?? "")) return "system_activity";
  if (/refreshed topic summary/i.test(summary ?? "")) return "system_activity";
  return "user_work_log";
}

/** Skip noisy or non-work entries in compact sidebars. */
export function shouldShowWorkLogInSidebar(action: string, summary?: string): boolean {
  return getWorkLogVisibility(action, summary) === "user_work_log";
}

export function shouldShowWorkLogInTopic(
  action: string,
  summary?: string,
  opts?: { isDm?: boolean },
): boolean {
  if (getWorkLogVisibility(action, summary) !== "user_work_log") return false;
  if (!opts?.isDm) return true;
  const key = action.trim().toLowerCase().replace(/\s+/g, "_");
  return !SYSTEM_WORK_LOG_ACTIONS.has(key);
}

export function shouldShowWorkLogInUserFeed(action: string, summary?: string): boolean {
  return shouldShowWorkLogInSidebar(action, summary);
}
