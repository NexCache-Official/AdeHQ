import type { AiEmployeeJobBrief } from "./types";
import { getRoleByKey } from "./role-library";
import { normalizeRecruiterAnswer } from "./normalize-recruiter-answer";
import { shouldSkipBriefMutationForMessage } from "./recruiter-intents";

const FOCUS_MAP: Record<string, { businessFocus: string; technicalFocus?: string; responsibility: string }> = {
  competitors: {
    businessFocus: "Competitive intelligence",
    responsibility: "Track competitor moves, positioning, and product changes",
  },
  "market size": {
    businessFocus: "Market sizing",
    responsibility: "Size addressable markets and growth trends with clear assumptions",
  },
  "customer segments": {
    businessFocus: "Customer segmentation",
    responsibility: "Map customer segments, needs, and buying patterns",
  },
  pricing: {
    businessFocus: "Pricing analysis",
    responsibility: "Analyze pricing models, packaging, and willingness-to-pay signals",
  },
  frontend: {
    businessFocus: "Frontend product engineering",
    technicalFocus: "Frontend product engineering",
    responsibility: "Own frontend product features, UI implementation, and user-facing quality",
  },
  "frontend product work": {
    businessFocus: "Frontend product engineering",
    technicalFocus: "Frontend product engineering",
    responsibility: "Own frontend product features, UI implementation, and user-facing quality",
  },
  backend: {
    businessFocus: "Backend systems",
    technicalFocus: "Backend systems and APIs",
    responsibility: "Own backend services, APIs, and data workflows",
  },
  "backend systems": {
    businessFocus: "Backend systems",
    technicalFocus: "Backend systems and APIs",
    responsibility: "Own backend services, APIs, and data workflows",
  },
  "full-stack": {
    businessFocus: "Full-stack product engineering",
    technicalFocus: "Full-stack product engineering",
    responsibility: "Ship features across frontend and backend with end-to-end ownership",
  },
  fullstack: {
    businessFocus: "Full-stack product engineering",
    technicalFocus: "Full-stack product engineering",
    responsibility: "Ship features across frontend and backend with end-to-end ownership",
  },
  "ai infrastructure": {
    businessFocus: "AI infrastructure",
    technicalFocus: "AI infrastructure and performance",
    responsibility: "Improve AI system performance, reliability, and infrastructure workflows",
  },
  qa: {
    businessFocus: "Quality assurance",
    technicalFocus: "QA and test engineering",
    responsibility: "Own test planning, bug triage, and release quality checks",
  },
  infra: {
    businessFocus: "Infrastructure and platform",
    technicalFocus: "Infrastructure and DevOps",
    responsibility: "Own deployments, reliability, and platform operations",
  },
};

function cloneBrief(brief: AiEmployeeJobBrief): AiEmployeeJobBrief {
  return {
    ...brief,
    coreResponsibilities: [...brief.coreResponsibilities],
    technicalFocus: [...brief.technicalFocus],
    businessFocus: [...brief.businessFocus],
    successMetrics: [...brief.successMetrics],
    personalityTraits: [...brief.personalityTraits],
    approvalRules: [...brief.approvalRules],
    toolsNeeded: [...brief.toolsNeeded],
    assumptions: [...brief.assumptions],
    openQuestions: [...brief.openQuestions],
  };
}

function normalizeChip(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesChip(text: string, chip: string): boolean {
  const a = normalizeChip(text);
  const b = normalizeChip(chip);
  return a === b || a.includes(b) || b.includes(a);
}

function pushUnique(list: string[], item: string): boolean {
  if (list.some((entry) => entry.toLowerCase() === item.toLowerCase())) return false;
  list.push(item);
  return true;
}

export function applyRoleFocusAnswer(
  answer: string,
  brief: AiEmployeeJobBrief,
  roleKey?: string | null,
): { brief: AiEmployeeJobBrief; focusLabel: string | null } | null {
  const trimmed = normalizeRecruiterAnswer(answer);
  if (!trimmed || trimmed.length > 120) return null;
  if (shouldSkipBriefMutationForMessage(trimmed)) return null;

  const role = getRoleByKey(roleKey ?? undefined);
  const chips = role?.questionTemplates.coreWorkChips ?? [];
  const matchedChip =
    chips.find((chip) => matchesChip(trimmed, chip)) ??
    Object.keys(FOCUS_MAP).find((key) => matchesChip(trimmed, key)) ??
    Object.keys(FOCUS_MAP).find((key) => normalizeChip(trimmed).includes(key));

  if (!matchedChip) {
    const stackMatch =
      /\b(next\.?js|supabase|react|typescript|api|mobile|internal tools?|general software|general engineering)\b/i.exec(
        trimmed,
      );
    if (stackMatch) {
      const next = cloneBrief(brief);
      const raw = stackMatch[0].toLowerCase();
      const label =
        raw === "general engineering"
          ? "General engineering"
          : stackMatch[0].charAt(0).toUpperCase() + stackMatch[0].slice(1);
      pushUnique(next.technicalFocus, label);
      if (!next.domain.trim() || next.domain.toLowerCase() === "software engineering") {
        next.domain = raw === "general engineering" ? "General software engineering" : label;
      }
      if (raw === "general engineering") {
        pushUnique(next.businessFocus, "General software engineering");
        pushUnique(
          next.coreResponsibilities,
          "Own pragmatic implementation work across the product as priorities shift",
        );
      }
      return { brief: next, focusLabel: label };
    }

    // Unmatched free text is not copied verbatim into the brief — the recruiter LLM
    // interprets semantics; rule-based fallback only maps known chips/keywords above.
    return null;
  }

  const mapping = FOCUS_MAP[normalizeChip(matchedChip)] ?? {
    businessFocus: matchedChip.charAt(0).toUpperCase() + matchedChip.slice(1),
    responsibility: `Own ${matchedChip.toLowerCase()} work for the team`,
  };

  const next = cloneBrief(brief);
  pushUnique(next.businessFocus, mapping.businessFocus);
  if (mapping.technicalFocus) pushUnique(next.technicalFocus, mapping.technicalFocus);
  pushUnique(next.coreResponsibilities, mapping.responsibility);
  pushUnique(next.assumptions, `Primary focus: ${mapping.businessFocus.toLowerCase()}.`);
  next.openQuestions = next.openQuestions.filter(
    (q) => !/focus areas matter most|what should this employee own/i.test(q),
  );

  return { brief: next, focusLabel: mapping.businessFocus };
}

export function acknowledgeUserAnswer(
  answer: string,
  brief: AiEmployeeJobBrief,
  roleKey?: string | null,
): string {
  const focus = applyRoleFocusAnswer(answer, brief, roleKey);
  if (focus?.focusLabel) {
    return `Got it — ${focus.focusLabel.toLowerCase()}.`;
  }

  const trimmed = answer.trim();
  if (trimmed.length <= 40) {
    return `Makes sense — ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}.`;
  }
  return "That helps — I'm folding this into the brief.";
}
