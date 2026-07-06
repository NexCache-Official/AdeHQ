import { isGeneralTopic, mainChatLabel } from "@/lib/topics";
import type { ProjectRoom, RoomTopic } from "@/lib/types";

const ACTION_LABELS: Record<string, string> = {
  draft_cold_email: "drafted cold email",
  reviewed_email_draft: "reviewed email draft",
  reviewed_cold_email_draft: "reviewed cold email draft",
  coordinated_team_response: "coordinated team plan",
  accepted_research_ownership: "accepted market research ownership",
  drafted_sales_outreach_plan: "drafted sales outreach plan",
  requested_market_clarification: "requested market clarification",
  prepared_research_plan: "prepared research plan",
  generated_business_brief: "generated business brief",
  panel_response_completed: "completed panel review",
  collaboration_completed: "coordinated team plan",
  handoff_completed: "completed handoff",
  orchestration_completed: "completed orchestration",
  topic_suggested: "suggested a topic",
  topic_created: "created a topic",
  messages_moved: "moved messages",
  topic_summary_refreshed: "refreshed topic summary",
  topic_summary_saved_to_memory: "saved topic summary to memory",
  topic_memory_suggested: "suggested topic memory",
  next_actions_suggested: "suggested next actions",
  memory_saved: "saved memory",
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
  saved_file_memory: "saved memory from file",
  read_context: "read context",
  // Integration Layer — Tool Execution Core actions
  crm_contact_created: "added a CRM contact",
  crm_contact_reused: "matched an existing CRM contact",
  crm_company_created: "added a CRM company",
  crm_company_reused: "matched an existing CRM company",
  crm_deal_created: "created a deal",
  crm_deal_stage_updated: "moved a deal to a new stage",
  created_email_draft: "drafted an email",
  task_created: "created a follow-up task",
  integration_tool_failed: "integration tool failed",
  integration_tool_executed: "ran an integration tool",
  tool_call_blocked: "was blocked from running a tool",
  artifact_spreadsheet_created: "generated a spreadsheet",
  artifact_pdf_created: "generated a PDF report",
  approval_requested: "requested approval",
  approval_granted: "approval granted",
  approval_rejected: "approval rejected",
  approval_revision_requested: "revision requested on approval",
  model_error: "hit a model error",
  model_fallback: "used fallback response",
  repeated_message_with_mention: "repeated message with mention after request",
  acknowledged_instruction: "acknowledged instruction",
};

const ACTION_CATEGORIES: Record<string, string> = {
  crm_contact_created: "Sales",
  crm_company_created: "Sales",
  crm_deal_created: "Sales",
  crm_contact_reused: "Sales",
  crm_company_reused: "Sales",
  created_email_draft: "Sales",
  task_created: "Tasks",
  coordinated_team_response: "Coordination",
  collaboration_completed: "Coordination",
  accepted_research_ownership: "Research",
  prepared_research_plan: "Research",
  drafted_sales_outreach_plan: "Sales",
  draft_cold_email: "Sales",
  memory_saved: "Memory",
  topic_summary_saved_to_memory: "Memory",
  saved_file_memory: "Memory",
  created_artifact: "Artifacts",
  generated_artifact: "Artifacts",
  created_prd: "Artifacts",
  created_report: "Artifacts",
  artifact_spreadsheet_created: "Artifacts",
  artifact_pdf_created: "Artifacts",
  task_suggested: "Tasks",
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

function normalizeActionKey(action: string): string {
  return action.trim().toLowerCase().replace(/\s+/g, "_");
}

function cleanSummaryText(summary?: string): string | undefined {
  const clean = summary?.trim();
  if (!clean) return undefined;
  if (/^none$/i.test(clean)) return undefined;
  if (/^[0-9a-f-]{36}$/i.test(clean)) return undefined;
  if (/orchestration|run_|msg_|queued|model\/|provider/i.test(clean)) return undefined;
  return clean;
}

/** Human-readable verb phrase from a work log action slug. */
export function humanizeWorkLogAction(action: string): string {
  const key = normalizeActionKey(action);
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(key)) {
    return key.replace(/_/g, " ");
  }
  return action.toLowerCase();
}

/** Display line: "Alex Chen coordinated team plan" */
export function formatWorkLogTitle(employeeName: string | undefined, action: string): string {
  const verb = humanizeWorkLogAction(action);
  const name = employeeName?.trim() || "AI employee";
  return `${name} ${verb}`;
}

export type WorkLogEntryDisplay = {
  title: string;
  summaryLine: string | null;
  category: string | null;
};

/** Structured work log copy: title, optional detail line, optional category. */
export function formatWorkLogEntryDisplay(
  employeeName: string | undefined,
  action: string,
  summary?: string,
): WorkLogEntryDisplay {
  const name = employeeName?.trim() || "AI employee";
  const key = normalizeActionKey(action);
  const clean = cleanSummaryText(summary);
  const category = ACTION_CATEGORIES[key] ?? null;

  if (clean?.toLowerCase().startsWith("saved memory:")) {
    const detail = clean.replace(/^saved memory:\s*/i, "").trim();
    return {
      title: `${name} saved memory`,
      summaryLine: detail && detail.toLowerCase() !== "none" ? detail : null,
      category: category ?? "Memory",
    };
  }

  if (clean?.toLowerCase().startsWith("saved topic summary to memory:")) {
    const detail = clean.replace(/^saved topic summary to memory:\s*/i, "").trim();
    return {
      title: `${name} saved topic summary to memory`,
      summaryLine: detail || null,
      category: category ?? "Memory",
    };
  }

  const title = formatWorkLogTitle(name, action);

  if (!clean) {
    return { title, summaryLine: null, category };
  }

  if (clean.toLowerCase() === title.toLowerCase()) {
    return { title, summaryLine: null, category };
  }

  if (
    clean.length <= 140 &&
    !clean.toLowerCase().startsWith(name.toLowerCase()) &&
    clean.length > humanizeWorkLogAction(action).length + 8
  ) {
    return { title, summaryLine: clean, category };
  }

  if (clean.length > title.length + 12 && !/^responded to/i.test(clean)) {
    return { title, summaryLine: clean, category };
  }

  return { title, summaryLine: null, category };
}

/** @deprecated Prefer formatWorkLogEntryDisplay */
export function formatWorkLogDisplay(
  employeeName: string | undefined,
  action: string,
  summary?: string,
): string {
  return formatWorkLogEntryDisplay(employeeName, action, summary).title;
}

export type WorkLogVisibility = "user_work_log" | "system_activity" | "debug_run_log";

export function getWorkLogVisibility(action: string, summary?: string): WorkLogVisibility {
  const key = normalizeActionKey(action);
  if (DEBUG_WORK_LOG_ACTIONS.has(key)) return "debug_run_log";
  if (SYSTEM_WORK_LOG_ACTIONS.has(key)) return "system_activity";
  const clean = cleanSummaryText(summary);
  if (/^greet/i.test(clean ?? "") || /^greet/i.test(action)) return "system_activity";
  if (/^noted\b/i.test(clean ?? "")) return "system_activity";
  if (/^will do\b/i.test(clean ?? "")) return "system_activity";
  if (/orchestration/i.test(clean ?? "")) return "system_activity";
  if (/refreshed topic summary/i.test(clean ?? "")) return "system_activity";
  if (/^responded to\b/i.test(clean ?? "") && clean!.length < 48) return "system_activity";
  return "user_work_log";
}

export type WorkLogFilterOptions = {
  debugEnabled?: boolean;
  isDm?: boolean;
};

function isVisibleWorkLog(
  action: string,
  summary?: string,
  opts?: WorkLogFilterOptions,
): boolean {
  const visibility = getWorkLogVisibility(action, summary);
  if (visibility === "debug_run_log") return Boolean(opts?.debugEnabled);
  if (visibility === "system_activity") return Boolean(opts?.debugEnabled);
  if (opts?.isDm) {
    const key = normalizeActionKey(action);
    if (SYSTEM_WORK_LOG_ACTIONS.has(key)) return false;
  }
  return visibility === "user_work_log";
}

/** Skip noisy or non-work entries in compact sidebars. */
export function shouldShowWorkLogInSidebar(
  action: string,
  summary?: string,
  opts?: WorkLogFilterOptions,
): boolean {
  return isVisibleWorkLog(action, summary, opts);
}

export function shouldShowWorkLogInTopic(
  action: string,
  summary?: string,
  opts?: WorkLogFilterOptions,
): boolean {
  return isVisibleWorkLog(action, summary, opts);
}

export function shouldShowWorkLogInUserFeed(
  action: string,
  summary?: string,
  opts?: WorkLogFilterOptions,
): boolean {
  return isVisibleWorkLog(action, summary, opts);
}

export type WorkLogSourceContext = {
  messages?: Array<{ id: string; senderName?: string; senderType?: string }>;
  topics?: RoomTopic[];
  room?: ProjectRoom;
  action?: string;
};

const ENTITY_SOURCE_LABELS: Record<string, string> = {
  topic: "Open topic",
  task: "Open task",
  memory: "Saved memory",
  file: "Open file",
  artifact: "Open artifact",
  approval: "Open approval",
  contact: "Open contact",
  deal: "Open deal",
  company: "Open company",
};

function topicChatLabel(topicId: string | undefined, ctx?: WorkLogSourceContext): string {
  const topic = ctx?.topics?.find((t) => t.id === topicId);
  if (!topic) return "General Chat";
  if (isGeneralTopic(topic)) return mainChatLabel(ctx?.room?.kind === "dm");
  return topic.title;
}

/** Human label for work log source link — never raw IDs or entity type slugs. */
export function workLogSourceLabel(
  event: {
    relatedEntityType?: string;
    relatedEntityId?: string;
    topicId?: string;
    action?: string;
  },
  ctx?: WorkLogSourceContext,
): string | null {
  const action = event.action ?? ctx?.action;
  const chatLabel = topicChatLabel(event.topicId, ctx);

  if (event.relatedEntityType === "message" && event.relatedEntityId && ctx?.messages) {
    const message = ctx.messages.find((m) => m.id === event.relatedEntityId);
    if (message?.senderName) {
      const firstName = message.senderName.split(/\s+/)[0] ?? message.senderName;
      if (message.senderType === "human") {
        return `${firstName}'s message in ${chatLabel}`;
      }
      const others = ctx.messages.filter(
        (m) => m.id !== message.id && m.senderType === "human" && m.senderName,
      );
      const priorHuman = others[others.length - 1];
      if (priorHuman?.senderName) {
        const humanFirst = priorHuman.senderName.split(/\s+/)[0] ?? priorHuman.senderName;
        return `${firstName}'s reply to ${humanFirst}`;
      }
      return `${firstName}'s reply in ${chatLabel}`;
    }
    return `Message in ${chatLabel}`;
  }

  if (event.relatedEntityType === "memory") {
    if (action && /memory_saved|saved_file_memory|memory_suggested/i.test(action)) {
      return "Suggested memory card";
    }
    return "Saved memory";
  }

  if (event.relatedEntityType === "topic" && event.topicId) {
    return chatLabel;
  }

  if (!event.relatedEntityType) return null;
  return ENTITY_SOURCE_LABELS[event.relatedEntityType] ?? null;
}

export function workLogCanJump(event: {
  relatedEntityType?: string;
  relatedEntityId?: string;
  topicId?: string;
}): boolean {
  if (event.relatedEntityType === "message" && event.relatedEntityId) return true;
  if (event.relatedEntityType === "topic" && event.topicId) return true;
  if (
    event.relatedEntityId &&
    (event.relatedEntityType === "contact" ||
      event.relatedEntityType === "deal" ||
      event.relatedEntityType === "company" ||
      event.relatedEntityType === "artifact")
  ) {
    return true;
  }
  if (event.relatedEntityType === "memory" && event.relatedEntityId) return false;
  if (event.topicId) return true;
  return false;
}
