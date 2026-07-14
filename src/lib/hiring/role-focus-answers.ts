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

/** Fuzzy synonyms so freeform answers map to role chips without an LLM round-trip. */
const FOCUS_SYNONYMS: Array<{ pattern: RegExp; chip: string }> = [
  { pattern: /\b(cold outreach|cold email|outbound|prospect(?:ing)?|landlord leads?)\b/i, chip: "Cold outreach" },
  { pattern: /\b(inbound|qualify|qualification)\b/i, chip: "Inbound qualification" },
  { pattern: /\b(follow[-\s]?ups?|nurture)\b/i, chip: "Follow-ups" },
  { pattern: /\b(account research|research accounts?|territory research)\b/i, chip: "Account research" },
  { pattern: /\b(list building|build(?:ing)? lists?)\b/i, chip: "List building" },
  { pattern: /\b(outbound campaigns?|sequences?)\b/i, chip: "Outbound campaigns" },
  { pattern: /\b(inbound capture|inbound leads?)\b/i, chip: "Inbound capture" },
  { pattern: /\b(competitors?|competitive)\b/i, chip: "competitors" },
  { pattern: /\b(market size|tam|sam)\b/i, chip: "market size" },
  { pattern: /\b(customer segments?|icp|segmentation)\b/i, chip: "customer segments" },
  { pattern: /\b(pricing|packaging)\b/i, chip: "pricing" },
];

function inferDomainFromFreeform(text: string, existingDomain: string): string | null {
  if (isSpecificLookingDomain(existingDomain)) return null;
  const lower = text.toLowerCase();
  const parts: string[] = [];
  if (/\blondon\b/.test(lower)) parts.push("London");
  else if (/\buk\b|united kingdom|england\b/.test(lower)) parts.push("UK");
  if (/\b(real estate|property|landlord|brokerage|estate agent)\b/.test(lower)) {
    parts.push("real estate brokerage");
  } else if (/\b(saas|b2b|fintech|healthcare|ecommerce|e-commerce)\b/.test(lower)) {
    const m = lower.match(/\b(saas|b2b|fintech|healthcare|ecommerce|e-commerce)\b/);
    if (m) parts.push(m[1].replace("e-commerce", "ecommerce"));
  }
  if (!parts.length) return null;
  return parts.join(" ");
}

function isSpecificLookingDomain(domain?: string): boolean {
  if (!domain?.trim()) return false;
  const trimmed = domain.trim();
  // Long / sentence-like values are usually pasted user answers, not domains.
  if (trimmed.length > 48 || /[.?!]/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  return ![
    "general business",
    "ai employee",
    "custom",
    "sales & revenue",
    "sales",
    "marketing",
    "research",
    "operations",
  ].includes(lower);
}

function interpretFreeformFocus(text: string): { businessFocus: string; responsibility: string } | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 12 || cleaned.length > 240) return null;
  // Prefer a short interpreted phrase — never paste a long user dump into the brief.
  const clause = cleaned.split(/[.—]| for our | so we | because /i)[0]?.trim() ?? cleaned;
  const phrase = clause.length > 72 ? `${clause.slice(0, 69).trim()}…` : clause;
  if (phrase.length < 8) return null;
  const label = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return {
    businessFocus: label,
    responsibility: `Own ${label.charAt(0).toLowerCase()}${label.slice(1)} work for the team`,
  };
}

export function applyRoleFocusAnswer(
  answer: string,
  brief: AiEmployeeJobBrief,
  roleKey?: string | null,
): { brief: AiEmployeeJobBrief; focusLabel: string | null } | null {
  const trimmed = normalizeRecruiterAnswer(answer);
  if (!trimmed || trimmed.length > 240) return null;
  if (shouldSkipBriefMutationForMessage(trimmed)) return null;

  const role = getRoleByKey(roleKey ?? undefined);
  const chips = role?.questionTemplates.coreWorkChips ?? [];
  const synonymChip = FOCUS_SYNONYMS.find((entry) => entry.pattern.test(trimmed))?.chip;
  const matchedChip =
    chips.find((chip) => matchesChip(trimmed, chip)) ??
    (synonymChip && (chips.some((chip) => matchesChip(synonymChip, chip)) || FOCUS_MAP[normalizeChip(synonymChip)])
      ? synonymChip
      : undefined) ??
    Object.keys(FOCUS_MAP).find((key) => matchesChip(trimmed, key)) ??
    Object.keys(FOCUS_MAP).find((key) => normalizeChip(trimmed).includes(key)) ??
    synonymChip;

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
      const inferredDomain = inferDomainFromFreeform(trimmed, next.domain);
      if (inferredDomain) next.domain = inferredDomain;
      return { brief: next, focusLabel: label };
    }

    // Interpret freeform locally so library-role hiring stays fast without LLM.
    const interpreted = interpretFreeformFocus(trimmed);
    if (!interpreted) return null;
    const next = cloneBrief(brief);
    pushUnique(next.businessFocus, interpreted.businessFocus);
    pushUnique(next.coreResponsibilities, interpreted.responsibility);
    pushUnique(next.assumptions, `Primary focus: ${interpreted.businessFocus.toLowerCase()}.`);
    const inferredDomain = inferDomainFromFreeform(trimmed, next.domain);
    if (inferredDomain) next.domain = inferredDomain;
    next.openQuestions = next.openQuestions.filter(
      (q) => !/focus areas matter most|what should this employee own|sales motion/i.test(q),
    );
    return { brief: next, focusLabel: interpreted.businessFocus };
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
  const inferredDomain = inferDomainFromFreeform(trimmed, next.domain);
  if (inferredDomain) next.domain = inferredDomain;
  next.openQuestions = next.openQuestions.filter(
    (q) => !/focus areas matter most|what should this employee own|sales motion/i.test(q),
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
    const domain = focus.brief.domain.trim();
    if (domain && isSpecificLookingDomain(domain)) {
      return `Got it — ${focus.focusLabel.toLowerCase()} for ${domain}.`;
    }
    return `Got it — ${focus.focusLabel.toLowerCase()}.`;
  }

  const trimmed = answer.trim();
  if (trimmed.length <= 40) {
    return `Makes sense — ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}.`;
  }
  return "That helps — I'm folding this into the brief.";
}
