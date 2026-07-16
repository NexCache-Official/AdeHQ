import type { ModelMode } from "@/lib/ai/model-catalog";
import {
  resolveEmployeeIntelligencePolicy,
  type IntelligenceMode,
} from "@/lib/ai/intelligence-policy";
import { mapWorkModeToIntensity } from "@/lib/brain/packet/cognitive-packet";
import type { BrainIntensity } from "@/lib/brain/catalog";
import { isBrainV1Enabled } from "@/lib/brain/flags";
import type { AIEmployee } from "@/lib/types";

const INTENSITY_RANK: Record<BrainIntensity, number> = {
  fast: 0,
  standard: 1,
  deep: 2,
  research: 3,
};

/** Raise intensity to at least the employee's legacy floor bias. */
export function applyIntensityFloor(
  intensity: BrainIntensity,
  floor?: BrainIntensity | null,
): BrainIntensity {
  if (!floor) return intensity;
  return INTENSITY_RANK[floor] > INTENSITY_RANK[intensity] ? floor : intensity;
}

/** Map chat intensity → legacy ModelMode for the existing capability router. */
export function modelModeFromIntensity(intensity: BrainIntensity): ModelMode {
  switch (intensity) {
    case "fast":
      return "cheap";
    case "deep":
      return "strong";
    case "research":
      return "long_context";
    case "standard":
    default:
      return "balanced";
  }
}

export function resolveEffectiveIntensity(params: {
  workMode?: string | null;
  preferredIntensityFloor?: BrainIntensity | null;
}): BrainIntensity {
  const fromWork = mapWorkModeToIntensity(params.workMode);
  return applyIntensityFloor(fromWork, params.preferredIntensityFloor);
}

/**
 * When Brain V1 + Auto: intensity (chips + floor) drives modelMode.
 * Kill switch / legacy tiers keep the provided modelMode.
 */
export function resolveBrainAwareModelMode(params: {
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">;
  heuristicModelMode: ModelMode;
  workMode?: string | null;
}): {
  brainEnabled: boolean;
  intelligenceMode: IntelligenceMode | string;
  intensity: BrainIntensity;
  modelMode: ModelMode;
  auto: boolean;
} {
  const policy = resolveEmployeeIntelligencePolicy(params.employee);
  const brainEnabled = isBrainV1Enabled();
  const auto = brainEnabled && policy.defaultMode === "auto";
  const intensity = resolveEffectiveIntensity({
    workMode: params.workMode,
    preferredIntensityFloor: policy.preferredIntensityFloor,
  });

  if (!auto) {
    return {
      brainEnabled,
      intelligenceMode: policy.defaultMode,
      intensity,
      modelMode: params.heuristicModelMode,
      auto: false,
    };
  }

  // Composer intensity wins when deeper than message heuristic; heuristic can still
  // escalate (e.g. coding / artifact) above the intensity-derived mode.
  const fromIntensity = modelModeFromIntensity(intensity);
  const modelMode = preferStrongerModelMode(fromIntensity, params.heuristicModelMode);

  return {
    brainEnabled,
    intelligenceMode: "auto",
    intensity,
    modelMode,
    auto: true,
  };
}

const MODE_RANK: Record<ModelMode, number> = {
  cheap: 0,
  creative: 1,
  balanced: 1,
  coding: 2,
  long_context: 2,
  strong: 3,
};

function preferStrongerModelMode(a: ModelMode, b: ModelMode): ModelMode {
  return (MODE_RANK[b] ?? 0) > (MODE_RANK[a] ?? 0) ? b : a;
}
