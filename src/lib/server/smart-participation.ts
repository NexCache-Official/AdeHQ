import type { AIEmployee, AiParticipationMode, ParticipationStyle } from "@/lib/types";
import { isBroadcastToEveryone } from "@/lib/server/channel-governance";

const ROLE_KEYWORDS: Record<string, string[]> = {
  pm: ["roadmap", "plan", "feature", "priority", "user", "onboarding", "requirements", "milestone", "scope", "product", "problem", "solution"],
  engineering: ["bug", "api", "database", "build", "code", "deploy", "error", "schema", "server", "fix", "technical", "implementation"],
  design: ["ui", "ux", "layout", "screen", "flow", "design", "confusing", "visual", "wireframe", "onboarding"],
  research: ["competitor", "market", "industry", "research", "find", "compare", "analysis", "benchmark", "booming", "segment", "trend"],
  marketing: ["launch", "copy", "landing", "content", "distribution", "campaign", "growth", "positioning", "brand"],
  gamedev: ["game", "unity", "godot", "asset", "level", "mechanics", "prototype", "plinko"],
  operations: ["process", "workflow", "ops", "incident", "support", "ticket"],
  sales: ["deal", "pipeline", "customer", "pricing", "demo", "prospect", "sales", "outreach", "sell", "lead", "leads"],
  support: ["help", "issue", "ticket", "customer", "support", "escalation"],
};

const STYLE_MULTIPLIER: Record<ParticipationStyle, number> = {
  quiet_specialist: 0.75,
  balanced_teammate: 1,
  proactive_operator: 1.25,
  critical_reviewer: 1.1,
  social_coordinator: 1.15,
};

const REVIEW_KEYWORDS = ["review", "decision", "risk", "approve", "blocker", "concern"];

function participationStyleOf(employee: AIEmployee): ParticipationStyle {
  return employee.participationStyle ?? "balanced_teammate";
}

function scoreEmployee(content: string, employee: AIEmployee, mode: AiParticipationMode): number {
  const text = content.toLowerCase();
  const keywords = ROLE_KEYWORDS[employee.roleKey] ?? [];
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score += 1;
  }

  const style = participationStyleOf(employee);
  score *= STYLE_MULTIPLIER[style] ?? 1;

  if (style === "critical_reviewer") {
    for (const kw of REVIEW_KEYWORDS) {
      if (text.includes(kw)) score += 0.5;
    }
  }

  if (mode === "smart_assist_lite" && score > 0 && score < 1.5) {
    score *= 0.85;
  }

  return score;
}

export function pickSmartResponders(
  content: string,
  employees: AIEmployee[],
  mode: AiParticipationMode,
  max: number,
): AIEmployee[] {
  if (
    mode === "manual_only" ||
    mode === "silent_observation" ||
    !employees.length
  ) {
    return [];
  }

  if (mode === "smart_assist_lite" && !isBroadcastToEveryone(content)) {
    const scored = employees
      .map((e) => ({ employee: e, score: scoreEmployee(content, e, mode) }))
      .filter((s) => s.score >= 1.5)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return [];
    return scored.slice(0, 1).map((s) => s.employee);
  }

  const scored = employees
    .map((e) => ({ employee: e, score: scoreEmployee(content, e, mode) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  const limit =
    mode === "active_team" ? Math.min(max, 2) : mode === "smart_assist" ? 1 : 1;
  const threshold = mode === "active_team" ? 1 : 1;

  return scored
    .filter((s) => s.score >= threshold)
    .slice(0, limit)
    .map((s) => s.employee);
}
