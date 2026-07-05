import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterMissingField,
  RecruiterReadiness,
} from "./types";
import { isHiringSmallTalk } from "./maya-recruiter-state";
import { acknowledgeUserAnswer } from "./role-focus-answers";
import { inferDepartmentId, isEngineeringBrief } from "./suggestion-chips";
import { getRoleByKey } from "./role-library";
import {
  approvalOrSkipped,
  hasDomainOrWorkContext,
  hasRoleFocusFromContext,
  hasUserConfirmedSeniority,
  meaningfulUserTurns,
  toolsOrSkipped,
} from "./recruiter-readiness-engineering";

export { generateSuggestionChips, inferDepartmentId, isEngineeringBrief, parseRecruiterSuggestionChips } from "./suggestion-chips";

function hasRealValue(value?: string) {
  if (!value?.trim()) return false;
  const lower = value.toLowerCase();
  return !["ai employee", "custom", "general business"].includes(lower);
}

const GENERIC_DOMAINS = new Set([
  "general business",
  "ai employee",
  "custom",
  "engineering",
  "software engineering",
  "product & roadmap",
  "product design & ux",
  "market & competitive research",
  "marketing & growth",
  "sales & revenue",
  "customer support",
  "business operations",
  "finance & accounting",
  "corporate legal & compliance",
  "people & hr operations",
  "pr & communications",
  "game development",
  "product",
  "research",
  "marketing",
  "sales",
  "operations",
  "design",
  "support",
  "finance",
  "legal",
  "hr",
]);

function isSpecificDomain(domain?: string): boolean {
  if (!hasRealValue(domain)) return false;
  return !GENERIC_DOMAINS.has(domain!.toLowerCase().trim());
}

export function assessRecruiterReadiness(
  conversation: RecruiterMessage[],
  currentBrief: AiEmployeeJobBrief,
  roleKey?: string | null,
): RecruiterReadiness {
  let score = 0;
  const missing: RecruiterMissingField[] = [];
  const userTurns = meaningfulUserTurns(conversation);
  const minTurns = 3;

  const roleKnown = hasRealValue(currentBrief.roleTitle);
  const focusKnown = hasRoleFocusFromContext(currentBrief, conversation);
  const domainKnown = isSpecificDomain(currentBrief.domain) || hasDomainOrWorkContext(currentBrief, conversation);
  const coreKnown =
    currentBrief.coreResponsibilities.length >= 2 ||
    focusKnown ||
    (userTurns >= 2 && currentBrief.businessFocus.length + currentBrief.technicalFocus.length > 0);
  const seniorityKnown = hasUserConfirmedSeniority(conversation);
  const toolsKnown = toolsOrSkipped(conversation);
  const approvalKnown = approvalOrSkipped(conversation);
  const qualityKnown = userTurns >= 1 && Boolean(currentBrief.qualityPreference);
  const communicationKnown =
    userTurns >= 1 &&
    (Boolean(currentBrief.communicationStyle?.trim()) || currentBrief.personalityTraits.length > 0);

  if (roleKnown) score += 15;
  else missing.push("role_title");

  if (domainKnown) score += 20;
  else missing.push("domain");

  if (focusKnown) score += 20;
  else missing.push(isEngineeringBrief(currentBrief) ? "technical_focus" : "business_focus");

  if (coreKnown) score += 10;
  else missing.push("core_work");

  if (seniorityKnown) score += 10;
  else missing.push("seniority", "autonomy");

  if (qualityKnown) score += 5;
  else missing.push("quality_preference");

  if (communicationKnown) score += 5;
  else missing.push("communication_style");

  if (toolsKnown) score += 7;
  else missing.push("tools");

  if (approvalKnown) score += 8;
  else missing.push("approval_rules");

  const coreComplete = roleKnown && focusKnown && domainKnown;
  const ready =
    userTurns >= minTurns &&
    coreComplete &&
    (seniorityKnown || userTurns >= 3);

  const confidence: RecruiterReadiness["confidence"] =
    score >= 78 ? "high" : score >= 45 ? "medium" : "low";

  return {
    score,
    ready,
    confidence,
    missing,
    nextBestQuestion: chooseNextRecruiterQuestion(
      { score, ready, confidence, missing, reason: "" },
      currentBrief,
      roleKey,
      conversation,
    ),
    reason: ready
      ? "The brief has enough role, focus, and context to review."
      : `Still gathering ${missing.slice(0, 3).join(", ").replaceAll("_", " ")}.`,
  };
}

export const EMPTY_READINESS: RecruiterReadiness = {
  score: 0,
  ready: false,
  confidence: "low",
  missing: ["role_title", "domain", "core_work"],
  nextBestQuestion: "What kind of AI employee do you want to hire?",
  reason: "No role context yet.",
};

/** Align displayed score with review readiness — core brief complete should read 92–100%, not 85%. */
export function finalizeReadinessScore(
  readiness: RecruiterReadiness,
  brief: AiEmployeeJobBrief,
  canReviewBrief: boolean,
): RecruiterReadiness {
  if (!canReviewBrief && !readiness.ready) return readiness;

  let displayScore = 92;
  if (brief.coreResponsibilities.length >= 3) displayScore += 2;
  if (brief.technicalFocus.length > 0 || brief.businessFocus.length > 0) displayScore += 2;
  if (brief.successMetrics.length >= 3) displayScore += 1;
  if (brief.communicationStyle?.trim() || brief.personalityTraits.length > 0) displayScore += 1;
  if (brief.seniorityLevel && brief.autonomyLevel) displayScore += 1;
  if (brief.toolsNeeded.length > 0 || brief.approvalRules.length > 0) displayScore += 1;
  displayScore = Math.min(100, displayScore);

  const optionalOnly = readiness.missing.every((field) =>
    ["tools", "approval_rules", "quality_preference", "communication_style"].includes(field),
  );

  return {
    ...readiness,
    ready: true,
    score: displayScore,
    confidence: displayScore >= 97 ? "high" : "medium",
    missing: optionalOnly
      ? readiness.missing.filter(
          (f) => f !== "tools" && f !== "approval_rules" && f !== "quality_preference" && f !== "communication_style",
        )
      : readiness.missing,
    reason: "The brief has enough role, domain, and work detail to review.",
    nextBestQuestion:
      readiness.nextBestQuestion ??
      "I have enough to draft a strong job brief. You can review it now, or keep refining the role.",
  };
}

export function chooseNextRecruiterQuestion(
  readiness: RecruiterReadiness,
  currentBrief: AiEmployeeJobBrief,
  roleKey?: string | null,
  conversation: RecruiterMessage[] = [],
): string {
  const missing = readiness.missing;
  const role = getRoleByKey(roleKey ?? undefined);
  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.text.trim() ?? "";
  const lastAde = [...conversation].reverse().find((m) => m.role === "ade")?.text ?? "";

  if (readiness.ready) {
    return "I have enough to draft the brief. Want to review it or generate candidates?";
  }
  if (missing.includes("role_title")) {
    return "What kind of role should this AI employee play for your team?";
  }
  if (missing.includes("business_focus") || missing.includes("technical_focus")) {
    if (role?.questionTemplates.coreWork) return role.questionTemplates.coreWork;
    if (isEngineeringBrief(currentBrief)) {
      return "Good choice. Should this engineer focus on frontend product work, backend systems, full-stack, AI infrastructure, or QA?";
    }
    return `What should this ${currentBrief.roleTitle || "employee"} focus on day to day?`;
  }
  if (missing.includes("domain")) {
    if (role?.questionTemplates.focus) return role.questionTemplates.focus;
    if (isEngineeringBrief(currentBrief)) {
      return "What stack or product area should they work with first? For example Next.js, Supabase, APIs, mobile, internal tools, or something else.";
    }
    return "What product, market, or part of the business should they focus on first?";
  }
  if (missing.includes("core_work")) {
    if (role?.questionTemplates.coreWork && !lastUser) {
      return role.questionTemplates.coreWork;
    }
    return "What outcomes should this hire drive in the next few months?";
  }
  if (missing.includes("quality_preference")) {
    return "Should they bias toward moving fast, balanced output, or higher polish before shipping?";
  }
  if (missing.includes("seniority") || missing.includes("autonomy")) {
    if (role?.questionTemplates.seniorityChips?.length) {
      return "How senior should they feel — hands-on executor, steady mid-level, or senior advisor?";
    }
    return "How much judgment should they carry — hands-on executor, steady mid-level, or senior advisor?";
  }
  if (missing.includes("communication_style")) {
    return "How should they show up in the team — concise and direct, warm and collaborative, or more formal?";
  }
  if (missing.includes("tools")) {
    return "Any tools or systems they should plug into from day one, or should we keep it lightweight for now?";
  }
  if (missing.includes("approval_rules")) {
    return "Anything they should always run by you first — external messages, spend, publishing, that kind of thing?";
  }

  if (lastAde && lastUser && normalizeQuestion(lastAde) === normalizeQuestion(lastUser)) {
    return "What else would make this hire feel like a strong fit?";
  }

  return "What else should I know to make this AI employee a better fit?";
}

function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildRecruiterTurnMessage(
  readiness: RecruiterReadiness,
  conversation: RecruiterMessage[],
  currentBrief: AiEmployeeJobBrief,
  roleKey?: string | null,
): string {
  const lastUser = [...conversation].reverse().find((m) => m.role === "user")?.text.trim() ?? "";
  const lastAde = [...conversation].reverse().find((m) => m.role === "ade")?.text ?? "";
  const nextQuestion = chooseNextRecruiterQuestion(readiness, currentBrief, roleKey, conversation);

  if (!lastUser || isHiringSmallTalk(lastUser)) {
    return nextQuestion;
  }

  if (readiness.ready) {
    return nextQuestion;
  }

  const ack = acknowledgeUserAnswer(lastUser, currentBrief, roleKey);
  if (normalizeQuestion(lastAde) === normalizeQuestion(nextQuestion)) {
    const alternate = chooseNextRecruiterQuestion(
      {
        ...readiness,
        missing: readiness.missing.filter((field) => field !== "core_work"),
      },
      currentBrief,
      roleKey,
      conversation,
    );
    if (normalizeQuestion(alternate) !== normalizeQuestion(lastAde)) {
      return `${ack} ${alternate}`;
    }
  }

  return `${ack} ${nextQuestion}`;
}
