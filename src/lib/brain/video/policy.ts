import type { VideoIntent, VideoPolicyDecision } from "./types";
import { VIDEO_ESTIMATE_CARD_SUMMARY, VIDEO_ESTIMATED_WH } from "./types";
import { memberLabelForVideoIntent } from "./select";

/**
 * Video is always approval-gated in the tool layer.
 * Server policy blocks when remaining WH cannot cover the full 29 WH charge.
 */
export function evaluateVideoGenerationPolicy(input: {
  intent: VideoIntent;
  remainingWh: number | null;
  unlimited?: boolean;
  warningLevel?: "ok" | "low" | "exhausted";
  enabled?: boolean;
}): VideoPolicyDecision {
  const estimatedWh = VIDEO_ESTIMATED_WH;
  const memberLabel = memberLabelForVideoIntent(input.intent);
  const remaining = input.unlimited ? null : input.remainingWh;
  const estimateCard = VIDEO_ESTIMATE_CARD_SUMMARY;

  if (input.enabled === false) {
    return {
      action: "blocked_disabled",
      estimatedWh,
      memberLabel,
      remainingWh: remaining,
      estimateCard,
      reason: "Video generation is turned off for this environment.",
    };
  }

  if (input.warningLevel === "exhausted") {
    return {
      action: "blocked_exhausted",
      estimatedWh,
      memberLabel,
      remainingWh: remaining,
      estimateCard,
      reason:
        "Work Hours are exhausted for this period. Wait for the weekly reset, or add more Work Hours before starting a 29 WH video.",
    };
  }

  if (!input.unlimited && remaining != null && remaining < estimatedWh) {
    return {
      action: "blocked_insufficient_wh",
      estimatedWh,
      memberLabel,
      remainingWh: remaining,
      estimateCard,
      reason: `This video needs ${estimatedWh} Work Hours, but only ${remaining.toFixed(2)} WH remain this period. Starting it would interrupt/fail mid-job — add Work Hours or wait for reset.`,
    };
  }

  return {
    action: "proceed",
    estimatedWh,
    memberLabel,
    remainingWh: remaining,
    estimateCard,
  };
}
