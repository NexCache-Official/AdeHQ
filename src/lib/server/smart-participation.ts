import type { AIEmployee, AiParticipationMode } from "@/lib/types";

const ROLE_KEYWORDS: Record<string, string[]> = {
  pm: ["roadmap", "plan", "feature", "priority", "user", "onboarding", "requirements", "milestone", "scope"],
  engineering: ["bug", "api", "database", "build", "code", "deploy", "error", "schema", "server", "fix"],
  design: ["ui", "ux", "layout", "screen", "flow", "design", "confusing", "visual", "wireframe"],
  research: ["competitor", "market", "research", "find", "compare", "analysis", "benchmark"],
  marketing: ["launch", "copy", "landing", "content", "distribution", "campaign", "growth"],
  gamedev: ["game", "unity", "godot", "asset", "level", "mechanics", "prototype", "plinko"],
  operations: ["process", "workflow", "ops", "incident", "support", "ticket"],
  sales: ["deal", "pipeline", "customer", "pricing", "demo", "prospect"],
  support: ["help", "issue", "ticket", "customer", "support", "escalation"],
};

function scoreEmployee(content: string, employee: AIEmployee): number {
  const text = content.toLowerCase();
  const keywords = ROLE_KEYWORDS[employee.roleKey] ?? [];
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score += 1;
  }
  return score;
}

export function pickSmartResponders(
  content: string,
  employees: AIEmployee[],
  mode: AiParticipationMode,
  max: number,
): AIEmployee[] {
  if (mode === "manual_only" || !employees.length) return [];

  const scored = employees
    .map((e) => ({ employee: e, score: scoreEmployee(content, e) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  const limit = mode === "active_team" ? Math.min(max, 2) : 1;
  const threshold = mode === "active_team" ? 1 : 1;

  return scored
    .filter((s) => s.score >= threshold)
    .slice(0, limit)
    .map((s) => s.employee);
}
