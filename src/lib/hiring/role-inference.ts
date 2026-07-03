import { synthesizeRoleTitle } from "./role-title-synthesizer";
import { isHiringSmallTalk } from "./maya-recruiter-state";
import { buildRecruiterOpeningMessage } from "./recruiter-openings";
import {
  getAllRoles,
  getRoleByKey,
  searchRoles,
  type RoleInferenceResult,
} from "./role-library";

const HIGH_THRESHOLD = 12;
const MEDIUM_THRESHOLD = 6;

const AMBIGUOUS_PATTERNS = [
  /more customers?/i,
  /grow (the )?business/i,
  /need help with/i,
  /want to improve/i,
  /i want to/i,
];

const OUTCOME_ROLE_BOOSTS: Array<{ pattern: RegExp; roleKeys: string[]; boost: number }> = [
  { pattern: /test|bug|qa|quality assurance/i, roleKeys: ["qa_test_engineer"], boost: 15 },
  { pattern: /write code|build and ship|ship features|develop/i, roleKeys: ["software_engineer", "full_stack_developer"], boost: 14 },
  { pattern: /outreach|cold email|prospect|sdr/i, roleKeys: ["sales_development_rep"], boost: 14 },
  { pattern: /lead gen|find leads|pipeline/i, roleKeys: ["lead_generation_specialist", "sales_development_rep"], boost: 12 },
  { pattern: /support|ticket|helpdesk/i, roleKeys: ["customer_support_agent", "technical_support_agent"], boost: 12 },
  { pattern: /research|competitor|market/i, roleKeys: ["market_research_analyst", "business_analyst"], boost: 11 },
  { pattern: /content|blog|copy/i, roleKeys: ["copywriter", "content_strategist"], boost: 11 },
  { pattern: /social media|tiktok|instagram/i, roleKeys: ["social_media_manager", "marketing_manager"], boost: 11 },
  { pattern: /bookkeep|invoice|expense/i, roleKeys: ["bookkeeping_assistant"], boost: 13 },
  { pattern: /automate|workflow|zapier/i, roleKeys: ["automation_specialist"], boost: 12 },
  { pattern: /data|dashboard|analytics|sql/i, roleKeys: ["data_analyst", "financial_analyst"], boost: 10 },
  { pattern: /product manager|roadmap|prd/i, roleKeys: ["product_manager"], boost: 12 },
  { pattern: /devops|deploy|infrastructure/i, roleKeys: ["devops_engineer"], boost: 12 },
  { pattern: /architect|integration/i, roleKeys: ["solutions_architect"], boost: 11 },
];

function scoreText(text: string): Array<{ roleKey: string; score: number; title: string }> {
  const lower = text.toLowerCase();
  const scores = new Map<string, number>();

  for (const role of getAllRoles()) {
    let score = 0;
    if (lower.includes(role.title.toLowerCase())) score += 20;
    for (const alias of role.searchAliases) {
      if (lower.includes(alias)) score += 8;
    }
    for (const use of role.commonUseCases) {
      if (lower.includes(use)) score += 6;
      // Avoid substring false positives (e.g. "hi" inside "ship").
      else if (lower.length >= 4 && use.includes(lower)) score += 6;
    }
    if (score > 0) scores.set(role.roleKey, score);
  }

  for (const boost of OUTCOME_ROLE_BOOSTS) {
    if (boost.pattern.test(text)) {
      for (const roleKey of boost.roleKeys) {
        scores.set(roleKey, (scores.get(roleKey) ?? 0) + boost.boost);
      }
    }
  }

  const searchHits = searchRoles(text, 5);
  for (let i = 0; i < searchHits.length; i++) {
    const role = searchHits[i];
    scores.set(role.roleKey, (scores.get(role.roleKey) ?? 0) + (8 - i));
  }

  return [...scores.entries()]
    .map(([roleKey, score]) => ({
      roleKey,
      score,
      title: getRoleByKey(roleKey)!.title,
    }))
    .sort((a, b) => b.score - a.score);
}

function isAmbiguousOutcome(text: string): boolean {
  return AMBIGUOUS_PATTERNS.some((p) => p.test(text)) && !/(engineer|qa|support|bookkeep|copywriter|analyst)/i.test(text);
}

export function inferRoleFromText(text: string): RoleInferenceResult {
  const trimmed = text.trim();
  if (!trimmed || isHiringSmallTalk(trimmed)) {
    return { confidence: "low", matches: [], matchType: "custom", customSuggestion: "AI Employee" };
  }

  const matches = scoreText(trimmed);
  const top = matches[0];
  const second = matches[1];

  if (isAmbiguousOutcome(trimmed)) {
    return {
      confidence: "low",
      matches: matches.slice(0, 5),
      matchType: "known",
    };
  }

  if (!top || top.score < MEDIUM_THRESHOLD) {
    const near = searchRoles(trimmed, 3);
    if (near.length > 0) {
      return {
        confidence: "medium",
        matches: near.map((r, i) => ({ roleKey: r.roleKey, score: 5 - i, title: r.title })),
        matchType: "near_match",
        nearMatchAlternatives: near.map((r) => r.roleKey),
        customSuggestion: synthesizeRoleTitle({ roleInput: trimmed }),
      };
    }
    return {
      confidence: "low",
      matches: [],
      matchType: "custom",
      customSuggestion: synthesizeRoleTitle({ roleInput: trimmed }),
      nearMatchAlternatives: ["business_analyst", "operations_assistant", "marketing_manager"],
    };
  }

  const gap = second ? top.score - second.score : top.score;
  if (top.score >= HIGH_THRESHOLD && gap >= 4) {
    return { confidence: "high", matches: [top], matchType: "known" };
  }

  if (matches.length >= 2 && top.score >= MEDIUM_THRESHOLD) {
    return {
      confidence: "medium",
      matches: matches.slice(0, 3),
      matchType: matches.length === 1 ? "known" : "near_match",
      nearMatchAlternatives: matches.slice(0, 3).map((m) => m.roleKey),
    };
  }

  return {
    confidence: "low",
    matches: matches.slice(0, 4),
    matchType: "near_match",
    nearMatchAlternatives: matches.slice(0, 3).map((m) => m.roleKey),
  };
}

export function inferenceOpeningMessage(text: string, result: RoleInferenceResult): string {
  if (result.confidence === "high" && result.matches[0]) {
    const match = result.matches[0];
    return buildRecruiterOpeningMessage({
      roleSeed: match.title,
      roleKey: match.roleKey,
    });
  }
  if (result.confidence === "medium" && result.matches.length > 0) {
    const options = result.matches.map((m) => m.title).join(", ");
    return `This could be a few different hires — perhaps ${options}. Which role is closest to what you need?`;
  }
  if (/more customers?/i.test(text)) {
    return "That could mean Sales, Marketing, or Customer Success. Are you trying to find new leads, convert leads, or retain existing customers?";
  }
  if (result.matchType === "custom") {
    return `I can create this as a custom role, or we can start from a similar hire. What fits best?`;
  }
  return "What outcome are you trying to achieve? I can help narrow down the right role.";
}

export function inferenceChipsForResult(result: RoleInferenceResult): Array<{ label: string; value: string; roleKey?: string }> {
  if (result.confidence === "high" && result.matches[0]) {
    return [
      { label: `Yes — ${result.matches[0].title}`, value: `Yes, hire a ${result.matches[0].title}`, roleKey: result.matches[0].roleKey },
      { label: "Choose a different role", value: "Let me pick a different role" },
    ];
  }
  if (result.matchType === "custom") {
    const alts = (result.nearMatchAlternatives ?? []).slice(0, 2).map((key) => getRoleByKey(key)).filter(Boolean);
    const chips = alts.map((r) => ({ label: r!.title, value: r!.title, roleKey: r!.roleKey }));
    chips.push({ label: "Create custom role", value: "Create this as a custom role", roleKey: "custom" });
    return chips;
  }
  return result.matches.slice(0, 3).map((m) => ({
    label: m.title,
    value: m.title,
    roleKey: m.roleKey,
  }));
}
