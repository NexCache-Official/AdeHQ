import type { ImageIntent, ImagePolicyDecision } from "./types";
import { estimatedWhForIntent, memberLabelForIntent } from "./select";

/**
 * Fair, member-safe generation gates:
 * - Standard (quick / business graphic): proceed unless WH are low or insufficient → ask confirm.
 * - Premium / edit: always surface the WH estimate; require explicit confirm.
 * - Exhausted / can't afford: blocked.
 */
export function evaluateImageGenerationPolicy(input: {
  intent: ImageIntent;
  remainingWh: number | null;
  unlimited?: boolean;
  warningLevel?: "ok" | "low" | "exhausted";
  confirmed?: boolean;
}): ImagePolicyDecision {
  const estimatedWh = estimatedWhForIntent(input.intent);
  const memberLabel = memberLabelForIntent(input.intent);
  const remaining = input.unlimited ? null : input.remainingWh;
  const warningLevel = input.warningLevel ?? "ok";

  if (!input.unlimited && remaining != null && remaining < estimatedWh) {
    return {
      action: "blocked",
      estimatedWh,
      memberLabel,
      remainingWh: remaining,
      reason: `This ${memberLabel.toLowerCase()} needs about ${estimatedWh} WH, but only ${remaining.toFixed(2)} WH remain this period.`,
    };
  }

  if (warningLevel === "exhausted") {
    return {
      action: "blocked",
      estimatedWh,
      memberLabel,
      remainingWh: remaining,
      reason: "Work Hours are exhausted for this period, so image generation is paused.",
    };
  }

  const isPremiumTier = input.intent === "premium" || input.intent === "edit";
  if (isPremiumTier && !input.confirmed) {
    return {
      action: "confirm_premium",
      estimatedWh,
      memberLabel,
      remainingWh: remaining,
      reason: `${memberLabel} uses about ${estimatedWh} WH. Confirm before generating, or pick a lighter option (${memberLabelForIntent("quick")} ~${estimatedWhForIntent("quick")} WH, ${memberLabelForIntent("business_graphic")} ~${estimatedWhForIntent("business_graphic")} WH).`,
    };
  }

  const lowBalance =
    warningLevel === "low" ||
    (remaining != null && remaining < estimatedWh * 3);
  if (!isPremiumTier && lowBalance && !input.confirmed) {
    return {
      action: "confirm_low_balance",
      estimatedWh,
      memberLabel,
      remainingWh: remaining,
      reason: `Work Hours are running low${remaining != null ? ` (~${remaining.toFixed(1)} WH left)` : ""}. ${memberLabel} will use about ${estimatedWh} WH — confirm to continue, or choose a smaller ask.`,
    };
  }

  return {
    action: "proceed",
    estimatedWh,
    memberLabel,
    remainingWh: remaining,
  };
}

/** Short fair comparison for employee replies (no model names). */
export function formatImageTierOptions(): string {
  return [
    `${memberLabelForIntent("quick")} — about ${estimatedWhForIntent("quick")} WH (fast everyday visuals)`,
    `${memberLabelForIntent("business_graphic")} — about ${estimatedWhForIntent("business_graphic")} WH (text-heavy / business layouts)`,
    `${memberLabelForIntent("edit")} — about ${estimatedWhForIntent("edit")} WH (edit an uploaded or prior image)`,
    `${memberLabelForIntent("premium")} — about ${estimatedWhForIntent("premium")} WH (highest quality campaign visuals)`,
  ].join("\n");
}
