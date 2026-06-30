import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterMissingField,
  RecruiterReadiness,
} from "./types";
import { inferDepartmentId, isEngineeringBrief } from "./suggestion-chips";
import { getRoleByKey } from "./role-library";

export { generateSuggestionChips, inferDepartmentId, isEngineeringBrief } from "./suggestion-chips";

function hasRealValue(value?: string) {
  if (!value?.trim()) return false;
  const lower = value.toLowerCase();
  return !["ai employee", "custom", "general business"].includes(lower);
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
  const hasUserTurns = conversation.some((m) => m.role === "user");

  const roleKnown = hasRealValue(currentBrief.roleTitle);
  const domainKnown = hasRealValue(currentBrief.domain);
  const coreKnown = currentBrief.coreResponsibilities.length >= 2;
  const focusKnown = currentBrief.technicalFocus.length > 0 || currentBrief.businessFocus.length > 0;
  const qualityKnown = Boolean(currentBrief.qualityPreference);
  const seniorityKnown = Boolean(currentBrief.seniorityLevel && currentBrief.autonomyLevel);
  const communicationKnown =
    Boolean(currentBrief.communicationStyle?.trim()) || currentBrief.personalityTraits.length > 0;
  const workflowKnown = currentBrief.toolsNeeded.length > 0 || currentBrief.approvalRules.length > 0;

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

  const ready = hasUserTurns && score >= 70 && roleKnown && domainKnown && coreKnown;
  const confidence: RecruiterReadiness["confidence"] = score >= 78 ? "high" : score >= 50 ? "medium" : "low";

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
    missing: optionalOnly ? readiness.missing.filter((f) => f !== "tools" && f !== "approval_rules") : readiness.missing,
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
    return `What domain or product area should this ${currentBrief.roleTitle || "employee"} understand best?`;
  }
  if (missing.includes("core_work")) {
    if (role?.questionTemplates.coreWork) return role.questionTemplates.coreWork;
    if (deptId === "pr") {
      return "What should this employee focus on day to day — press releases, media relations, internal comms, crisis response, or something else?";
    }
    if (deptId === "marketing") {
      return "What should this employee own — content, campaigns, social, SEO, or a mix?";
    }
    if (deptId === "sales") {
      return "What sales work should they handle — lead qualification, outreach, proposals, or pipeline follow-ups?";
    }
    if (isEngineeringBrief(currentBrief)) {
      return "What should this employee focus on day to day — frontend, backend, AI infrastructure, or data workflows?";
    }
    return "What should this employee focus on day to day?";
  }
  if (missing.includes("technical_focus")) {
    return "Should this role focus more on frontend, backend systems, AI infrastructure, or data workflows?";
  }
  if (missing.includes("business_focus")) {
    return `Which business outcomes should this ${currentBrief.roleTitle || "employee"} own or support?`;
  }
  if (missing.includes("seniority") || missing.includes("autonomy")) {
    return "Should this employee be hands-on and implementation-focused, or more of a senior advisor who reviews and guides work?";
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
  return "What else should Ade know to make this AI employee a better fit?";
}
