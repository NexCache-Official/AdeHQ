/** Human-readable labels for Work Hours shadow UI (V19.9.1b). */

export const CAPABILITY_LABELS: Record<string, string> = {
  summarization: "Summaries",
  classification: "Classification",
  structured_chat: "Structured replies",
  embedding: "File understanding",
  quick_reply: "Quick replies",
  artifact_generation: "Artifacts",
  deep_reasoning: "Deep reasoning",
  research_planning: "Research planning",
  browser_research: "Browser research",
  long_context: "Long context",
  coding: "Coding",
  memory_curation: "Memory curation",
  reasoning: "Reasoning",
};

export const WORK_TYPE_LABELS: Record<string, string> = {
  topic_summary: "Topic summaries",
  orchestration_classify: "Orchestration",
  hiring_recruiter: "Hiring recruiter",
  hiring_candidates: "Hiring candidates",
  file_embedding: "File embeddings",
  browser_research: "Browser research",
  employee_direct_response_shadow: "Direct replies shadow",
  employee_queued_response_shadow: "Queued replies shadow",
  employee_direct_response: "Direct replies",
  employee_queued_response: "Queued replies",
  email_ask_employee: "Inbox ask employee",
  email_prepare_proposal: "Inbox prepare proposal",
  email_extract_work_suggestions: "Inbox extract suggestions",
  email_memory_curation: "Inbox memory curation",
  email_decision_generation: "Inbox decision drafting",
  email_triage: "Inbox triage",
  email_draft: "Inbox draft",
  email_draft_rewrite: "Inbox draft rewrite",
};

export const WORK_HOURS_SHADOW_BADGE = "Shadow estimate — not billed";

export const WORK_HOURS_SHADOW_HELPER =
  "These estimates help AdeHQ calibrate AI Work Hours. They are not used for billing or limits yet.";

const FORBIDDEN_UI_COPY = [
  "remaining hours",
  "hours left",
  "upgrade",
  "blocked",
  "limit reached",
  "out of hours",
  "billing due",
  "charged",
  "invoice",
  "payment required",
  "you have",
] as const;

export function formatCapabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability.replace(/_/g, " ");
}

export function formatWorkTypeLabel(workType: string): string {
  return WORK_TYPE_LABELS[workType] ?? workType.replace(/_/g, " ");
}

/** Round to nearest whole minute for display. */
export function formatEstimatedMinutes(minutes: number): string {
  return String(Math.round(minutes));
}

/** Round to two decimal places for display. */
export function formatEstimatedHours(hours: number): string {
  return (Math.round(hours * 100) / 100).toFixed(2);
}

export function formatBillingWeekRange(weekStart: string): string {
  const start = parseUtcDate(weekStart);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${fmt.format(start)} – ${fmt.format(end)} (UTC)`;
}

export function isEmptyShadowSummary(params: {
  totalEstimatedMinutes: number;
  byEmployee: unknown[];
  byCapability: unknown[];
  byWorkType: unknown[];
}): boolean {
  return (
    params.totalEstimatedMinutes <= 0 &&
    params.byEmployee.length === 0 &&
    params.byCapability.length === 0 &&
    params.byWorkType.length === 0
  );
}

export function assertNoForbiddenBillingCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return !FORBIDDEN_UI_COPY.some((phrase) => lower.includes(phrase));
}

export function collectWorkHoursShadowUiCopy(): string[] {
  return [
    WORK_HOURS_SHADOW_BADGE,
    WORK_HOURS_SHADOW_HELPER,
    "AI Usage",
    "Estimated Work Hours",
    "Estimated Work Minutes",
    "By employee",
    "By capability",
    "By work type",
    "Debug details",
    "No shadow Work Hours recorded for this week yet.",
    "Unable to load shadow Work Hours.",
  ];
}

function parseUtcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}
