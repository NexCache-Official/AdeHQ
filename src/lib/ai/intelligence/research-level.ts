import type { IntelligenceContext } from "./intelligence-context";
import type { ResearchPlan } from "@/lib/ai/research/research-planner";

export type ResearchLevel = 0 | 1 | 2 | 3;

export function assignResearchLevel(
  intelligence: IntelligenceContext | undefined,
  plan: ResearchPlan | null,
): ResearchLevel {
  if (!intelligence) return plan?.action === "browse" ? 3 : plan?.action === "search" ? 1 : 0;

  if (
    intelligence.composer?.answerSource === "instant" ||
    intelligence.composer?.answerSource === "knowledge" ||
    shouldAnswerDirect(intelligence)
  ) {
    return 0;
  }

  if (plan?.action === "browse") {
    return intelligence.workMode === "research" || intelligence.fastPath?.decision === "obvious_browser_research"
      ? 3
      : 2;
  }

  if (plan?.action === "search") {
    if (
      intelligence.workMode === "research" ||
      intelligence.fastPath?.decision === "obvious_browser_research"
    ) {
      return 2;
    }
    return 1;
  }

  if (intelligence.router?.route === "search") return 1;
  if (intelligence.router?.route === "browse") return 3;
  if (intelligence.fastPath?.decision === "obvious_search") return 1;

  return 0;
}

function shouldAnswerDirect(intelligence: IntelligenceContext): boolean {
  const fp = intelligence.fastPath?.decision;
  return fp === "greeting" || fp === "instant_answer" || fp === "direct" || fp === "clarify";
}
