import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterMissingField,
  RecruiterReadiness,
  RecruiterSuggestionChip,
} from "./types";

function hasRealValue(value?: string) {
  if (!value?.trim()) return false;
  const lower = value.toLowerCase();
  return !["ai employee", "custom", "general business"].includes(lower);
}

function pushChip(
  chips: RecruiterSuggestionChip[],
  label: string,
  value: string,
  intent: RecruiterSuggestionChip["intent"] = "answer_question",
) {
  chips.push({
    id: `${intent}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    label,
    value,
    intent,
  });
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
  else missing.push(currentBrief.department === "Engineering" ? "technical_focus" : "business_focus");

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
): string {
  const missing = readiness.missing;

  if (readiness.ready) {
    return "I have enough to draft a strong job brief. You can review it now, or keep refining the role.";
  }
  if (missing.includes("role_title")) {
    return "What kind of role should this AI employee play for your team?";
  }
  if (missing.includes("domain")) {
    return `What domain or product area should this ${currentBrief.roleTitle} understand best?`;
  }
  if (missing.includes("core_work")) {
    return "What should this employee focus on day to day?";
  }
  if (missing.includes("technical_focus")) {
    return "Should this role focus more on frontend, backend systems, AI infrastructure, or data workflows?";
  }
  if (missing.includes("business_focus")) {
    return "Which business outcomes should this employee own or support?";
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

export function generateSuggestionChips(
  readiness: RecruiterReadiness,
  currentBrief: AiEmployeeJobBrief,
): RecruiterSuggestionChip[] {
  const chips: RecruiterSuggestionChip[] = [];
  const missing = readiness.missing;
  const isEngineering =
    currentBrief.department === "Engineering" ||
    /engineer|software|saas|platform|ai/i.test(currentBrief.roleTitle);

  if (readiness.ready) {
    pushChip(chips, "Review job brief", "Review job brief", "review_brief");
    pushChip(chips, "Refine responsibilities", "Refine responsibilities", "refine_more");
    pushChip(chips, "Add tools", "Add tools", "add_tools");
    pushChip(chips, "Make it more senior", "Make it more senior", "answer_question");
    pushChip(chips, "Make it more hands-on", "Make it more hands-on", "answer_question");
    return chips;
  }

  if (missing.includes("core_work") || missing.includes("technical_focus")) {
    if (isEngineering) {
      pushChip(chips, "Frontend product engineering", "Frontend product engineering");
      pushChip(chips, "Backend systems", "Backend systems");
      pushChip(chips, "AI infrastructure", "AI infrastructure");
      pushChip(chips, "Data science workflows", "Data science workflows");
      pushChip(chips, "Not sure — help me decide", "Not sure — help me decide");
      return chips;
    }
    pushChip(chips, "Strategy and planning", "Strategy and planning");
    pushChip(chips, "Execution and follow-ups", "Execution and follow-ups");
    pushChip(chips, "Research and analysis", "Research and analysis");
    pushChip(chips, "Not sure — help me decide", "Not sure — help me decide");
    return chips;
  }

  if (missing.includes("seniority") || missing.includes("autonomy")) {
    pushChip(chips, "Hands-on specialist", "Hands-on specialist");
    pushChip(chips, "Senior advisor", "Senior advisor");
    pushChip(chips, "Autonomous manager", "Autonomous manager");
    pushChip(chips, "Balanced", "Balanced");
    return chips;
  }

  if (missing.includes("tools")) {
    pushChip(chips, "GitHub and issue tracker", "GitHub and issue tracker", "add_tools");
    pushChip(chips, "Analytics dashboards", "Analytics dashboards", "add_tools");
    pushChip(chips, "Docs and knowledge base", "Docs and knowledge base", "add_tools");
    return chips;
  }

  if (missing.includes("approval_rules")) {
    pushChip(chips, "Ask before external actions", "Ask before external actions", "add_approval_rules");
    pushChip(chips, "Ask before production changes", "Ask before production changes", "add_approval_rules");
    pushChip(chips, "Escalate high-risk decisions", "Escalate high-risk decisions", "add_approval_rules");
    return chips;
  }

  pushChip(chips, "Draft brief now", "Draft brief now", "draft_brief_now");
  pushChip(chips, "Add personality", "Add personality", "add_personality");
  pushChip(chips, "Add tools", "Add tools", "add_tools");
  return chips;
}
