import type { RoutingPreference } from "@/lib/ai/intelligence-policy";
import type { ModelMode } from "@/lib/ai/model-catalog";
import type { CandidateTier } from "./types";

export type CandidateArchetype = {
  tier: CandidateTier;
  badge: string;
  operatingStyle: string;
  /** Member-facing intelligence label — always Auto under Brain V1. */
  defaultIntelligence: string;
  /** Internal hire seed only (intensity floor + kill-switch fallback). Not shown as a tier picker. */
  modelMode: ModelMode;
  routingPreference: RoutingPreference;
  routingBehavior: string;
  /** @deprecated Not shown in member hire UI. */
  commonModels: string;
  personalityTags: string[];
  grad: string;
};

export const CANDIDATE_ARCHETYPES: Record<CandidateTier, CandidateArchetype> = {
  high_capacity: {
    tier: "high_capacity",
    badge: "Fast Executor",
    operatingStyle: "Fast executor",
    defaultIntelligence: "Auto",
    modelMode: "cheap",
    routingPreference: "cost_saver",
    routingBehavior: "AdeHQ picks the brain per task. Prefers lighter routes and upgrades when work gets complex.",
    commonModels: "",
    personalityTags: ["energetic", "practical", "direct", "fast-moving"],
    grad: "linear-gradient(135deg,#fbbf24,#f97316 55%,#ef4444)",
  },
  recommended: {
    tier: "recommended",
    badge: "Balanced Partner",
    operatingStyle: "Balanced operator",
    defaultIntelligence: "Auto",
    modelMode: "balanced",
    routingPreference: "auto",
    routingBehavior: "AdeHQ assembles the right brain for each task — speed, cost, and quality.",
    commonModels: "",
    personalityTags: ["collaborative", "reliable", "organized", "clear"],
    grad: "linear-gradient(135deg,#6366f1,#3b82f6 55%,#8b5cf6)",
  },
  premium: {
    tier: "premium",
    badge: "Senior Strategist",
    operatingStyle: "Senior strategist",
    defaultIntelligence: "Auto",
    modelMode: "strong",
    routingPreference: "quality_first",
    routingBehavior: "AdeHQ picks the brain per task, with a deeper default for complex or high-stakes work.",
    commonModels: "",
    personalityTags: ["strategic", "precise", "senior", "thoughtful"],
    grad: "linear-gradient(135deg,#64748b,#7c3aed 65%,#1e293b)",
  },
};

export function archetypePitch(tier: CandidateTier, roleTitle: string, domain: string): string {
  const role = roleTitle.toLowerCase();
  const area = domain.toLowerCase() || "this role";
  if (tier === "high_capacity") {
    return `Moves quickly from brief to draft. Best when you give clear goals and want practical ${role} work fast.`;
  }
  if (tier === "premium") {
    return `Best when ${area} needs senior judgment, positioning, and careful tradeoffs.`;
  }
  return `Reliable day-to-day partner for ${role} work — balances speed, quality, and cost.`;
}

export function archetypeBestFor(tier: CandidateTier, briefRole: string): string {
  const role = briefRole.toLowerCase();
  if (tier === "high_capacity") {
    return `Quick drafts, high-volume work, and practical ${role} execution.`;
  }
  if (tier === "premium") {
    return `Complex strategy, positioning, and executive-ready ${role} work.`;
  }
  return `Dependable day-to-day ${role} strategy and execution.`;
}

export function archetypeWatchOuts(tier: CandidateTier): string[] {
  if (tier === "high_capacity") {
    return ["Needs clear goals upfront", "Less suited for ambiguous strategy"];
  }
  if (tier === "premium") {
    return ["Can be overpowered for simple low-stakes work", "May take longer on routine tasks"];
  }
  return ["May ask clarifying questions before ambiguous work", "Not the deepest specialist on every edge case"];
}

export function archetypeHowIWork(tier: CandidateTier): string[] {
  if (tier === "high_capacity") {
    return ["Short implementation loops", "Quick updates", "Asks for clear goals upfront"];
  }
  if (tier === "premium") {
    return [
      "Frames decisions before execution",
      "Explains tradeoffs clearly",
      "Prefers fewer, higher-quality outputs",
    ];
  }
  return ["Clarifies goals", "Keeps work structured", "Balances speed and quality"];
}

export function archetypeStrengths(tier: CandidateTier, brief: { technicalFocus: string[] }): string[] {
  if (brief.technicalFocus.length > 0) {
    if (tier === "high_capacity") return ["Fast technical drafts", "Quick iteration loops", "Practical debugging notes"];
    if (tier === "premium") return ["Architecture tradeoffs", "Senior technical judgment", "Executive-ready summaries"];
    return ["Structured technical planning", "Clear implementation notes", "Reliable follow-through"];
  }
  if (tier === "high_capacity") return ["High-volume output", "Fast follow-ups", "Quick first drafts"];
  if (tier === "premium") return ["Strategic depth", "Senior stakeholder messaging", "Complex problem framing"];
  return ["Balanced quality and clarity", "Dependable execution", "Clear communication"];
}
