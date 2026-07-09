import type { IntelligenceContext } from "./intelligence-context";

export type RunStatusChip =
  | "reading"
  | "thinking"
  | "searching"
  | "from_cache"
  | "research_report"
  | "typing";

export function minimumReplyHoldMs(
  intelligence: IntelligenceContext | undefined,
  aiMode?: string,
): number {
  if (aiMode === "gateway_search" || aiMode === "research") return 800;
  if (!intelligence) return 1200;

  const fp = intelligence.fastPath?.decision;
  if (fp === "greeting" || fp === "clarify") return 0;
  if (intelligence.composer?.answerSource === "knowledge") return 800;
  if (intelligence.composer?.answerSource === "cache") return 600;
  if (intelligence.cache?.hit) return 600;
  if (fp === "obvious_search") return 1000;
  if (fp === "obvious_browser_research") return 1200;
  if (fp === "direct") return 900;
  if (intelligence.workMode === "fast") return 500;
  if (intelligence.workMode === "deep" || intelligence.workMode === "research") return 1500;
  return 1100;
}

export function statusChipForIntelligence(
  intelligence: IntelligenceContext | undefined,
  aiMode?: string,
): RunStatusChip {
  if (intelligence?.cache?.hit || intelligence?.composer?.answerSource === "cache") {
    return "from_cache";
  }
  if (aiMode === "gateway_search" || intelligence?.search) return "searching";
  if (aiMode === "research" || aiMode === "research_async") return "research_report";
  if (intelligence?.fastPath?.decision === "obvious_search") return "searching";
  if (intelligence?.fastPath?.decision === "obvious_browser_research") return "research_report";
  if (intelligence?.composer?.answerSource === "knowledge") return "thinking";
  return "typing";
}

export function statusChipLabel(chip: RunStatusChip): string {
  switch (chip) {
    case "reading":
      return "Reading context…";
    case "thinking":
      return "Thinking…";
    case "searching":
      return "Checking current sources…";
    case "from_cache":
      return "Using verified cache…";
    case "research_report":
      return "Running research…";
    case "typing":
    default:
      return "Typing…";
  }
}
