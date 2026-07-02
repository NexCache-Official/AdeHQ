import type { AiEmployeeJobBrief } from "./types";
import { getRoleByKey } from "./role-library";

const FOCUS_MAP: Record<string, { businessFocus: string; responsibility: string }> = {
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
  const trimmed = answer.trim();
  if (!trimmed || trimmed.length > 120) return null;

  const role = getRoleByKey(roleKey ?? undefined);
  const chips = role?.questionTemplates.coreWorkChips ?? [];
  const matchedChip =
    chips.find((chip) => matchesChip(trimmed, chip)) ??
    Object.keys(FOCUS_MAP).find((key) => matchesChip(trimmed, key));

  if (!matchedChip) return null;

  const mapping = FOCUS_MAP[normalizeChip(matchedChip)] ?? {
    businessFocus: matchedChip.charAt(0).toUpperCase() + matchedChip.slice(1),
    responsibility: `Own ${matchedChip.toLowerCase()} work for the team`,
  };

  const next = cloneBrief(brief);
  pushUnique(next.businessFocus, mapping.businessFocus);
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
