import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterMissingField,
  RecruiterReadiness,
} from "./types";
import { isHiringSmallTalk } from "./maya-recruiter-state";
import { inferDepartmentId, isEngineeringBrief } from "./suggestion-chips";
import { getRoleByKey } from "./role-library";

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

function meaningfulUserTurns(conversation: RecruiterMessage[]): number {
  return conversation.filter(
    (m) => m.role === "user" && !isHiringSmallTalk(m.text) && m.text.trim().length > 3,
  ).length;
}

export const EMPTY_READINESS: RecruiterReadiness = {
  score: 0,
  ready: false,
  confidence: "low",
  missing: ["role_title", "domain", "core_work"],
  nextBestQuestion: "What kind of AI employee do you want to hire?",
  reason: "No role context yet.",
};

export function assessRecruiterReadiness(
  conversation: RecruiterMessage[],
  currentBrief: AiEmployeeJobBrief,
): RecruiterReadiness {
  let score = 0;
  const missing: RecruiterMissingField[] = [];
  const userTurns = meaningfulUserTurns(conversation);
  const engineering = isEngineeringBrief(currentBrief);
  const minTurns = engineering ? 3 : 2;

  const roleKnown = hasRealValue(currentBrief.roleTitle);
  const domainKnown = isSpecificDomain(currentBrief.domain);
  const coreKnown = userTurns >= 2 && currentBrief.coreResponsibilities.length >= 2;
  const focusKnown =
    userTurns >= 1 &&
    (currentBrief.technicalFocus.length > 0 || currentBrief.businessFocus.length > 0);
  const qualityKnown = userTurns >= 1 && Boolean(currentBrief.qualityPreference);
  const seniorityKnown =
    userTurns >= 1 && Boolean(currentBrief.seniorityLevel && currentBrief.autonomyLevel);
  const communicationKnown =
    userTurns >= 1 &&
    (Boolean(currentBrief.communicationStyle?.trim()) || currentBrief.personalityTraits.length > 0);
  const workflowKnown =
    userTurns >= 1 && (currentBrief.toolsNeeded.length > 0 || currentBrief.approvalRules.length > 0);

  if (roleKnown) score += 15;
  else missing.push("role_title");

  if (domainKnown) score += 15;
  else missing.push("domain");

  if (coreKnown) score += 20;
  else missing.push("core_work");

  if (focusKnown) score += 15;
  else missing.push(engineering ? "technical_focus" : "business_focus");

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
        undefined,
      ),
      reason: ready
        ? "The brief has enough role, domain, and work detail to review."
        : `Still missing ${missing.slice(0, 3).join(", ").replaceAll("_", " ")}.`,
    },
    currentBrief,
    ready,
  );
}

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
): string {
  const missing = readiness.missing;
  const role = getRoleByKey(roleKey ?? undefined);
  const deptId = inferDepartmentId(currentBrief);

  if (readiness.ready) {
    return "I have enough to draft a strong job brief. You can review it now, or keep refining the role.";
  }
  if (missing.includes("role_title")) {
    return "What kind of role should this AI employee play for your team?";
  }
  if (missing.includes("domain")) {
    return `What product or domain should this ${currentBrief.roleTitle || "employee"} mainly work with? For example: your core product, a new initiative, or a specific market.`;
  }
  if (missing.includes("core_work")) {
    if (role?.questionTemplates.coreWork) return role.questionTemplates.coreWork;
    if (isEngineeringBrief(currentBrief)) {
      return "What should this engineer own first — building new features, fixing bugs, full-stack product work, infrastructure, or something else?";
    }
    return "What should this employee focus on day to day?";
  }
  if (missing.includes("technical_focus")) {
    return "What product or stack will they mainly work with? For example: Next.js, Supabase, React, APIs, mobile, internal tools, or something else.";
  }
  if (missing.includes("business_focus")) {
    return `Which business outcomes should this ${currentBrief.roleTitle || "employee"} own or support?`;
  }
  if (missing.includes("seniority") || missing.includes("autonomy")) {
    return "How senior should they feel — a fast implementer, a reliable mid-level builder, or a senior engineer who can make architecture decisions?";
  }
  if (missing.includes("communication_style")) {
    return "How should this employee communicate with you and the team?";
  }
  if (missing.includes("tools")) {
    return "What tools or systems should this employee use or understand?";
  }
  if (missing.includes("approval_rules")) {
    return "What should this employee ask for approval before doing?";
  }
  return "What else should I know to make this AI employee a better fit?";
}
