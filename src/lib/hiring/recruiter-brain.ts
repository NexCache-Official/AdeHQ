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
  hasEngineeringDiscipline,
  hasProductContext,
  hasUserConfirmedSeniority,
  meaningfulUserTurns,
  toolsOrSkipped,
} from "./recruiter-readiness-engineering";

export { generateSuggestionChips, inferDepartmentId, isEngineeringBrief } from "./suggestion-chips";

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

function assessEngineeringReadiness(
  conversation: RecruiterMessage[],
  currentBrief: AiEmployeeJobBrief,
): RecruiterReadiness {
  let score = 0;
  const missing: RecruiterMissingField[] = [];
  const userTurns = meaningfulUserTurns(conversation);
  const minTurns = 3;

  const roleKnown = hasRealValue(currentBrief.roleTitle);
  const disciplineKnown = hasEngineeringDiscipline(currentBrief, conversation);
  const productKnown = hasProductContext(currentBrief, conversation);
  const seniorityKnown = hasUserConfirmedSeniority(conversation);
  const toolsKnown = toolsOrSkipped(conversation);
  const approvalKnown = approvalOrSkipped(conversation);

  if (roleKnown) score += 15;
  else missing.push("role_title");

  if (disciplineKnown) score += 20;
  else missing.push("technical_focus");

  if (productKnown) score += 20;
  else missing.push("domain");

  if (seniorityKnown) score += 15;
  else {
    missing.push("seniority");
    missing.push("autonomy");
  }

  if (toolsKnown) score += 15;
  else missing.push("tools");

  if (approvalKnown) score += 15;
  else missing.push("approval_rules");

  const ready =
    userTurns >= minTurns &&
    roleKnown &&
    disciplineKnown &&
    productKnown &&
    seniorityKnown &&
    toolsKnown &&
    approvalKnown;

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
      "software_engineer",
      conversation,
    ),
    reason: ready
      ? "Engineering role, focus, product context, seniority, and workflow guardrails are clear enough to review."
      : `Still gathering ${missing.slice(0, 3).join(", ").replaceAll("_", " ")}.`,
  };
}

export function assessRecruiterReadiness(
  conversation: RecruiterMessage[],
  currentBrief: AiEmployeeJobBrief,
  roleKey?: string | null,
): RecruiterReadiness {
  if (isEngineeringBrief(currentBrief) || roleKey === "software_engineer" || roleKey === "full_stack_developer") {
    return assessEngineeringReadiness(conversation, currentBrief);
  }

  let score = 0;
  const missing: RecruiterMissingField[] = [];
  const userTurns = meaningfulUserTurns(conversation);
  const minTurns = 2;

  const roleKnown = hasRealValue(currentBrief.roleTitle);
  const domainKnown = isSpecificDomain(currentBrief.domain);
  const coreKnown =
    userTurns >= 1 &&
    (currentBrief.businessFocus.length > 0 ||
      currentBrief.technicalFocus.length > 0 ||
      currentBrief.coreResponsibilities.length >= 2);
  const focusKnown =
    userTurns >= 1 &&
    (currentBrief.technicalFocus.length > 0 || currentBrief.businessFocus.length > 0);
  const qualityKnown = userTurns >= 1 && Boolean(currentBrief.qualityPreference);
  const seniorityKnown =
    userTurns >= 1 && hasUserConfirmedSeniority(conversation);
  const communicationKnown =
    userTurns >= 1 &&
    (Boolean(currentBrief.communicationStyle?.trim()) || currentBrief.personalityTraits.length > 0);
  const workflowKnown =
    userTurns >= 1 && (toolsOrSkipped(conversation) || approvalOrSkipped(conversation));

  if (roleKnown) score += 15;
  else missing.push("role_title");

  if (domainKnown) score += 15;
  else missing.push("domain");

  if (coreKnown) score += 20;
  else missing.push("core_work");

  if (focusKnown) score += 15;
  else missing.push(isEngineeringBrief(currentBrief) ? "technical_focus" : "business_focus");

  if (qualityKnown) score += 10;
  else missing.push("quality_preference");

  if (seniorityKnown) score += 10;
  else missing.push("seniority", "autonomy");

  if (communicationKnown) score += 10;
  else missing.push("communication_style");

  if (workflowKnown) score += 5;
  else missing.push("tools", "approval_rules");

  const ready =
    userTurns >= minTurns &&
    roleKnown &&
    domainKnown &&
    coreKnown &&
    focusKnown &&
    (seniorityKnown || qualityKnown);

  const confidence: RecruiterReadiness["confidence"] =
    score >= 78 ? "high" : score >= 50 ? "medium" : "low";

  return finalizeReadinessScore(
    {
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
        ? "The brief has enough role, domain, and work detail to review."
        : `Still missing ${missing.slice(0, 3).join(", ").replaceAll("_", " ")}.`,
    },
    currentBrief,
    ready,
  );
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
    ["tools", "approval_rules", "quality_preference"].includes(field),
  );

  return {
    ...readiness,
    ready: true,
    score: displayScore,
    confidence: displayScore >= 97 ? "high" : "medium",
    missing: optionalOnly
      ? readiness.missing.filter((f) => f !== "tools" && f !== "approval_rules")
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
  if (isEngineeringBrief(currentBrief) && missing.includes("technical_focus")) {
    return "Good choice. Should this engineer focus on frontend product work, backend systems, full-stack, AI infrastructure, or QA?";
  }
  if (isEngineeringBrief(currentBrief) && missing.includes("domain")) {
    return "What stack or product area should they work with first? For example Next.js, Supabase, APIs, mobile, internal tools, or something else.";
  }
  if (isEngineeringBrief(currentBrief) && (missing.includes("seniority") || missing.includes("autonomy"))) {
    return "How senior should they feel: fast implementer, reliable mid-level builder, or senior architect?";
  }
  if (missing.includes("domain")) {
    return `What product or market should they focus on? For example, your core product, a new category, or a specific customer segment.`;
  }
  if (missing.includes("core_work")) {
    if (role?.questionTemplates.coreWork && !lastUser) {
      return role.questionTemplates.coreWork;
    }
    if (isEngineeringBrief(currentBrief)) {
      return "What should they own first — new features, bugs, full-stack work, infra, or something else?";
    }
    return "What should this employee focus on day to day?";
  }
  if (missing.includes("technical_focus")) {
    return "What stack or systems will they mainly work with — Next.js, APIs, mobile, internal tools, or something else?";
  }
  if (missing.includes("business_focus")) {
    if (role?.title.toLowerCase().includes("research")) {
      return "Which market or product should they watch — your category, a new segment, or a specific competitor set?";
    }
    return `What outcomes should this ${currentBrief.roleTitle || "employee"} drive in the next few months?`;
  }
  if (missing.includes("quality_preference")) {
    return "Should they bias toward moving fast, balanced output, or higher polish before shipping?";
  }
  if (missing.includes("seniority") || missing.includes("autonomy")) {
    return "How much judgment should they carry — hands-on executor, steady mid-level, or senior advisor?";
  }
  if (missing.includes("communication_style")) {
    return "How should they show up in the team — concise and direct, warm and collaborative, or more formal?";
  }
  if (missing.includes("tools")) {
    return "Any tools or stack they should plug into from day one, or should we keep it lightweight for now?";
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
