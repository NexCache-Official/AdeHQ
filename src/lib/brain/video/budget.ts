import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceCapacity } from "@/lib/billing/usage/periods";
import { VIDEO_ESTIMATED_WH } from "./types";
import { IMAGE_INTENT_WH } from "@/lib/brain/image/types";

/**
 * Member-safe Work Hours budget block for employee / steward prompts.
 * Helps the model refuse jobs that would exceed remaining weekly WH.
 */
export async function buildWorkHoursBudgetPrompt(
  client: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  try {
    const capacity = await getWorkspaceCapacity(client, workspaceId);
    if (capacity.unlimited) {
      return [
        "WORK HOURS BUDGET (ground truth for this period):",
        "- This workspace has unlimited AI Work Hours this period.",
        `- Still prefer lighter options when the human asks casually (e.g. image ~${IMAGE_INTENT_WH.quick}–${IMAGE_INTENT_WH.premium} WH vs video ${VIDEO_ESTIMATED_WH} WH).`,
        "- Never invent model names. Discuss costs only in Work Hours.",
      ].join("\n");
    }

    const remaining = capacity.remaining;
    const videoAffordable = remaining >= VIDEO_ESTIMATED_WH;
    const resetsHint = capacity.resetsAt
      ? `Period resets around ${capacity.resetsAt}.`
      : "Period resets on the workspace usage schedule (typically Mon 00:00 UTC).";

    const lines = [
      "WORK HOURS BUDGET (ground truth for this period — use this before expensive media):",
      `- Remaining: ${remaining.toFixed(2)} WH (used ${capacity.used.toFixed(2)} of ${capacity.allowance.toFixed(2)}; warning=${capacity.warningLevel}).`,
      `- ${resetsHint}`,
      `- Image tiers: Create image ~${IMAGE_INTENT_WH.quick} WH · business graphic ~${IMAGE_INTENT_WH.business_graphic} WH · edit ~${IMAGE_INTENT_WH.edit} WH · premium ~${IMAGE_INTENT_WH.premium} WH.`,
      `- Video: Create one five-second video costs ${VIDEO_ESTIMATED_WH} Work Hours (approval required before execution).`,
    ];

    if (!videoAffordable) {
      lines.push(
        `- Video is NOT affordable right now (${remaining.toFixed(2)} WH left < ${VIDEO_ESTIMATED_WH}). Do not start video.create — explain it would fail/interrupt, and suggest adding Work Hours or waiting for reset. Offer a cheaper image instead if that still helps.`,
      );
    } else if (capacity.warningLevel === "low" || remaining < VIDEO_ESTIMATED_WH * 1.5) {
      lines.push(
        `- Remaining WH are tight relative to a ${VIDEO_ESTIMATED_WH} WH video. Warn clearly before proposing video; prefer image options unless the human explicitly wants video.`,
      );
    } else {
      lines.push(
        `- Video is affordable. Still ask clarifying questions and wait for approval — never auto-spend ${VIDEO_ESTIMATED_WH} WH.`,
      );
    }

    lines.push("- Never burn Work Hours on jobs that cannot finish within remaining capacity.");
    return lines.join("\n");
  } catch (error) {
    console.warn(
      "[AdeHQ video] WH budget prompt failed",
      error instanceof Error ? error.message : error,
    );
    return [
      "WORK HOURS BUDGET:",
      `- Video costs ${VIDEO_ESTIMATED_WH} Work Hours per five-second clip. If capacity cannot be verified, ask the human before proposing video.`,
    ].join("\n");
  }
}
