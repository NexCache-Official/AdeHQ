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
  // PR-14: Exa primary for all external web retrieval; Perplexity then Tavily.
  {
    capability: "search_semantic",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_search_exa",
    backupRouteIds: ["route_search_perplexity", "route_search_tavily"],
  },
  {
    capability: "search_semantic",
    intensity: "research",
    environment: "production",
    primaryRouteId: "route_search_exa",
    backupRouteIds: ["route_search_perplexity", "route_search_tavily"],
  },
  {
    capability: "search_fast",
    intensity: "fast",
    environment: "production",
    primaryRouteId: "route_search_exa",
    backupRouteIds: ["route_search_perplexity", "route_search_tavily"],
  },
  {
    capability: "search_fast",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_search_exa",
    backupRouteIds: ["route_search_perplexity", "route_search_tavily"],
  },
  {
    capability: "research_planning",
    intensity: "research",
    environment: "production",
    primaryRouteId: "route_search_exa",
    backupRouteIds: ["route_search_perplexity", "route_search_tavily"],
  },
  // PR-15: VL-8B standard; VL-32B-Thinking for complex / deep / research.
  {
    capability: "vision",
    intensity: "fast",
    environment: "production",
    primaryRouteId: "route_vision_qwen3_vl_8b_sf",
    backupRouteIds: ["route_vision_qwen3_vl_32b_sf"],
  },
  {
    capability: "vision",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_vision_qwen3_vl_8b_sf",
    backupRouteIds: ["route_vision_qwen3_vl_32b_sf"],
  },
  {
    capability: "vision",
    intensity: "deep",
    environment: "production",
    primaryRouteId: "route_vision_qwen3_vl_32b_sf",
    backupRouteIds: ["route_vision_qwen3_vl_8b_sf"],
  },
  {
    capability: "vision",
    intensity: "research",
    environment: "production",
    primaryRouteId: "route_vision_qwen3_vl_32b_sf",
    backupRouteIds: ["route_vision_qwen3_vl_8b_sf"],
  },
  // PR-16: intent→route is selected in brain/image; policy documents live primaries.
  {
    capability: "image_generation",
    intensity: "fast",
    environment: "production",
    primaryRouteId: "route_image_z_image_turbo",
    backupRouteIds: ["route_image_qwen_image"],
  },
  {
    capability: "image_generation",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_image_qwen_image",
    backupRouteIds: ["route_image_z_image_turbo", "route_image_flux2_flex"],
  },
  {
    capability: "image_generation",
    intensity: "deep",
    environment: "production",
    primaryRouteId: "route_image_flux2_flex",
    backupRouteIds: ["route_image_qwen_image"],
  },
  {
    capability: "image_edit",
    intensity: "standard",
    environment: "production",
    primaryRouteId: "route_image_qwen_image_edit",
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
