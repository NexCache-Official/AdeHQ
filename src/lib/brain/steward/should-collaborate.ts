import type {
  CollaborationSkipReason,
  CollaborationTriggerDecision,
  CollaborationTriggerReason,
} from "./types";

const GREETING =
  /^(hi|hello|hey|thanks|thank you|good (morning|afternoon|evening)|gm|yo)\b/i;
const SIMPLE_FACTUAL =
  /^(what('s| is) (the )?(date|time|day)|who are you|what can you do)\b/i;
const ORDINARY_SEARCH =
  /\b(search|look up|find|google)\b.{0,40}\b(for|about)?\b.{0,60}$/i;
const SHORT_WRITING =
  /\b(draft|write|rewrite|rephrase|summarize|summarise)\b.{0,80}$/i;
const BASIC_CALC = /\b(calculate|compute|add|subtract|multiply|divide|%\b|percent)\b/i;

const CROSS_DOMAIN =
  /\b(and also|plus|as well as)\b.{0,40}\b(research|design|code|legal|finance|market|engineering|sales|marketing)\b/i;
const RESEARCH_ARTIFACT =
  /\b(research|analyze|analyse|investigate)\b[\s\S]{0,120}\b(draft|write|create|build|prepare|pitch|deck|outreach|plan)\b/i;
const VERIFICATION =
  /\b(verify|double[- ]?check|independently (review|check)|second opinion|peer review)\b/i;
const CODING_REVIEW =
  /\b(code|implement|fix|refactor)\b[\s\S]{0,100}\b(review|critique|audit)\b/i;
const CONSEQUENTIAL =
  /\b(board|investor|launch plan|go[- ]to[- ]market|compliance|legal review|security review)\b/i;
const MULTI_SYSTEM =
  /\b(crm|inbox|drive|calendar|github|slack)\b.+\b(and|&)\b.+\b(crm|inbox|drive|calendar|github|slack)\b/i;
const EXPLICIT_TEAM =
  /\b(work with|coordinate with|collaborate with|team up|loop in|bring in|@\w+.+\b(and|&)\b\s*@)\b/i;

export type ShouldCollaborateInput = {
  message: string;
  mentionedEmployeeCount: number;
  isPrivateDm: boolean;
  accessibleEmployeeCount: number;
  /** Legacy ConversationPlan / OrchestrationPlan mode when available. */
  legacyMode?: string | null;
};

/**
 * Deterministic gate: when Steward should consider multi-employee collaboration.
 * Does not allocate work — only decides whether a multi-step plan is warranted.
 */
export function shouldCollaborate(input: ShouldCollaborateInput): CollaborationTriggerDecision {
  const text = input.message.trim();
  const reasons: CollaborationTriggerReason[] = [];
  const skipReasons: CollaborationSkipReason[] = [];

  if (input.isPrivateDm) {
    return { collaborate: false, reasons, skipReasons: ["private_dm"] };
  }
  if (input.accessibleEmployeeCount < 1) {
    return { collaborate: false, reasons, skipReasons: ["no_accessible_employees"] };
  }
  if (!text || /^(just noting|for the record|leaving this)\b/i.test(text)) {
    return { collaborate: false, reasons, skipReasons: ["silent"] };
  }

  if (GREETING.test(text) && text.length < 80) {
    skipReasons.push("greeting");
  }
  if (SIMPLE_FACTUAL.test(text)) skipReasons.push("simple_factual");
  if (ORDINARY_SEARCH.test(text) && text.length < 160) skipReasons.push("ordinary_search");
  if (SHORT_WRITING.test(text) && text.length < 200 && input.mentionedEmployeeCount <= 1) {
    skipReasons.push("short_writing");
  }
  if (BASIC_CALC.test(text) && text.length < 120) skipReasons.push("basic_calculation");

  if (input.mentionedEmployeeCount >= 2 || EXPLICIT_TEAM.test(text)) {
    reasons.push("explicit_multi_mention");
  }
  if (CROSS_DOMAIN.test(text)) reasons.push("cross_domain");
  if (RESEARCH_ARTIFACT.test(text)) reasons.push("research_plus_artifact");
  if (VERIFICATION.test(text)) reasons.push("verification_requested");
  if (CODING_REVIEW.test(text)) reasons.push("coding_plus_review");
  if (CONSEQUENTIAL.test(text)) reasons.push("consequential_review");
  if (MULTI_SYSTEM.test(text)) reasons.push("multi_system");

  const legacy = (input.legacyMode ?? "").toLowerCase();
  if (
    legacy === "lead_collaborator" ||
    legacy === "handoff" ||
    legacy === "panel_response" ||
    legacy === "multi_employee_collaboration"
  ) {
    reasons.push("legacy_collaboration_mode");
  }

  if (reasons.length === 0) {
    if (skipReasons.length === 0) skipReasons.push("single_employee_sufficient");
    return { collaborate: false, reasons, skipReasons };
  }

  // Explicit collaboration signals win over soft skip heuristics
  return { collaborate: true, reasons, skipReasons: [] };
}
