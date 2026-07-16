import type { BrainCapability } from "./capabilities";
import type { BrainRouteEnvironment } from "./routes";

export type BrainIntensity = "fast" | "standard" | "deep" | "research";

export type RoutingPolicyEntry = {
  capability: BrainCapability;
  intensity: BrainIntensity;
  environment: BrainRouteEnvironment;
  primaryRouteId: string;
  backupRouteIds: string[];
};

/**
 * Live production scoring policy only.
 * Shadow/evaluation routes are intentionally absent — they must not win production picks.
 * Classification stays on Qwen3-8B until Step-3.5-Flash wins PR-13 shadow eval.
 */
export const ROUTING_POLICY: RoutingPolicyEntry[] = [
  {
    capability: "quick_reply",
    intensity: "fast",
    environment: "production",
    primaryRouteId: "route_text_v4flash_sf_quick",
    backupRouteIds: ["route_text_v4flash_sf"],
  },
  {
    capability: "reasoning",
    intensity: "fast",
    environment: "production",
    primaryRouteId: "route_text_v4flash_sf",
    backupRouteIds: ["route_text_qwen3_8b_sf"],
  },
  {
    capability: "reasoning",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_text_v4flash_sf",
    backupRouteIds: ["route_text_qwen3_8b_sf"],
  },
  {
    capability: "deep_reasoning",
    intensity: "deep",
    environment: "production",
    primaryRouteId: "route_text_v4pro_vg",
    backupRouteIds: ["route_text_v4pro_sf_failover"],
  },
  {
    capability: "deep_reasoning",
    intensity: "research",
    environment: "production",
    primaryRouteId: "route_text_v4pro_vg",
    backupRouteIds: ["route_text_v4pro_sf_failover"],
  },
  {
    capability: "long_context",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_text_minimax_m25_vg",
    backupRouteIds: ["route_text_minimax_m25_vg_native", "route_text_minimax_m25_sf"],
  },
  {
    capability: "coding",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_text_qwen3_coder_sf",
    backupRouteIds: [],
  },
  {
    capability: "classification",
    intensity: "fast",
    environment: "production",
    primaryRouteId: "route_text_qwen3_8b_sf",
    backupRouteIds: ["route_text_v4flash_sf"],
  },
  {
    capability: "embedding",
    intensity: "fast",
    environment: "production",
    primaryRouteId: "route_embed_qwen3_sf",
    backupRouteIds: [],
  },
  {
    capability: "browser_research",
    intensity: "research",
    environment: "production",
    primaryRouteId: "route_browser_browserbase",
    backupRouteIds: [],
  },
  {
    capability: "research_planning",
    intensity: "research",
    environment: "production",
    primaryRouteId: "route_search_tavily",
    backupRouteIds: [],
  },
];

export function resolveRoutingPolicy(
  capability: BrainCapability,
  intensity: BrainIntensity,
  environment: BrainRouteEnvironment = "production",
): RoutingPolicyEntry | null {
  return (
    ROUTING_POLICY.find(
      (p) =>
        p.capability === capability &&
        p.intensity === intensity &&
        p.environment === environment,
    ) ??
    ROUTING_POLICY.find(
      (p) => p.capability === capability && p.environment === environment,
    ) ??
    null
  );
}
