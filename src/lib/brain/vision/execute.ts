import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { costUsdFromSnapshot } from "@/lib/brain/catalog/pricing-snapshots";
import { isBrainVisionV1Enabled } from "@/lib/brain/flags";
import { recordBrainUsage } from "@/lib/brain/metering";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import { callSiliconFlowVision } from "./adapter";
import {
  assessVisionConfidence,
  extractUnderstandingText,
  inferVisionNeed,
  shouldEscalateFromStandard,
  shouldStartOnEscalationRoute,
} from "./confidence";
import {
  loadVisualAssetsFromEmailAttachments,
  loadVisualAssetsFromWorkspaceFiles,
} from "./normalize";
import { buildVisionPromptBlock } from "./prompt";
import type {
  NormalizedVisualAsset,
  VisionAttemptRecord,
  VisionRouteId,
  VisionUnderstandingResult,
} from "./types";

export type ExecuteVisionParams = {
  client: SupabaseClient;
  workspaceId: string;
  roomId?: string | null;
  topicId?: string | null;
  employeeId?: string | null;
  userId?: string | null;
  workUnitId?: string | null;
  brainRunId?: string | null;
  messageId?: string | null;
  userMessage: string;
  attachmentFileIds?: string[];
  emailThreadId?: string | null;
  emailMessageId?: string | null;
  intensity?: "fast" | "standard" | "deep" | "research";
  /** Pre-normalized assets (tests / callers that already loaded bytes). */
  assets?: NormalizedVisualAsset[];
};

async function meterAttempt(params: {
  client: SupabaseClient;
  workspaceId: string;
  routeId: VisionRouteId;
  attempt: VisionAttemptRecord;
  employeeId?: string | null;
  userId?: string | null;
  workUnitId?: string | null;
  brainRunId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  messageId?: string | null;
  attemptIndex: number;
}): Promise<number> {
  const snap = getLiveSeedSnapshot(params.routeId);
  const costUsd =
    params.attempt.costUsd ||
    (snap
      ? costUsdFromSnapshot(snap, {
          inputTokens: params.attempt.inputTokens,
          outputTokens: params.attempt.outputTokens,
        })
      : 0);
  params.attempt.costUsd = costUsd;

  await recordBrainUsage({
    client: params.client,
    workspaceId: params.workspaceId,
    idempotencyKey: `${params.workUnitId ?? params.brainRunId ?? params.messageId ?? "vision"}:vision:${params.attemptIndex}:${params.routeId}`,
    employeeId: params.employeeId,
    userId: params.userId,
    workUnitId: params.workUnitId,
    brainRunId: params.brainRunId,
    roomId: params.roomId,
    topicId: params.topicId,
    messageId: params.messageId,
    sourceType: "file_analysis",
    routeId: params.routeId,
    usage: {
      inputTokens: params.attempt.inputTokens,
      outputTokens: params.attempt.outputTokens,
      imageCount: 0,
    },
    status: params.attempt.outcome === "failed" ? "failed" : "succeeded",
    billableToWorkspace: params.attempt.outcome !== "failed",
    providerCalled: true,
    workType: "vision_understanding",
    capability: "vision",
    runtimeMode: "multimodal",
    metadata: {
      routeId: params.routeId,
      visionNeed: params.attempt.need,
      confidence: params.attempt.confidence,
      latencyMs: params.attempt.latencyMs,
      workHours: workHoursFromCost(costUsd),
    },
  });

  return costUsd;
}

export async function executeVisionUnderstanding(
  params: ExecuteVisionParams,
): Promise<VisionUnderstandingResult | null> {
  if (!isBrainVisionV1Enabled()) {
    return null;
  }

  let assets = params.assets ?? [];
  if (!assets.length) {
    const fromFiles = await loadVisualAssetsFromWorkspaceFiles(params.client, {
      workspaceId: params.workspaceId,
      fileIds: params.attachmentFileIds ?? [],
      userMessage: params.userMessage,
    });
    const fromInbox = await loadVisualAssetsFromEmailAttachments(params.client, {
      workspaceId: params.workspaceId,
      emailThreadId: params.emailThreadId,
      emailMessageId: params.emailMessageId,
      userMessage: params.userMessage,
    });
    assets = [...fromFiles, ...fromInbox].slice(0, 4);
  }

  if (!assets.length) {
    return null;
  }

  const need = inferVisionNeed({
    userMessage: params.userMessage,
    intensity: params.intensity,
    assetCount: assets.length,
    hasLowQualityHint: assets.some((a) => a.kind === "low_quality_scan"),
  });

  const attempts: VisionAttemptRecord[] = [];
  const startRoute: VisionRouteId = shouldStartOnEscalationRoute(need)
    ? "route_vision_qwen3_vl_32b_sf"
    : "route_vision_qwen3_vl_8b_sf";

  let winningRoute: VisionRouteId = startRoute;
  let understanding = "";
  let confidence = 0;
  let escalated = false;

  const runRoute = async (routeId: VisionRouteId) => {
    const call = await callSiliconFlowVision({
      routeId,
      userMessage: params.userMessage,
      assets,
    });
    const assessment = assessVisionConfidence({
      rawText: call.text,
      userMessage: params.userMessage,
      need,
    });
    const attempt: VisionAttemptRecord = {
      routeId,
      need,
      outcome: "succeeded",
      latencyMs: call.latencyMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsd: 0,
      confidence: assessment.confidence,
    };
    await meterAttempt({
      client: params.client,
      workspaceId: params.workspaceId,
      routeId,
      attempt,
      employeeId: params.employeeId,
      userId: params.userId,
      workUnitId: params.workUnitId,
      brainRunId: params.brainRunId,
      roomId: params.roomId,
      topicId: params.topicId,
      messageId: params.messageId,
      attemptIndex: attempts.length,
    });
    attempts.push(attempt);
    return { call, assessment };
  };

  try {
    const first = await runRoute(startRoute);
    understanding = extractUnderstandingText(first.call.text);
    confidence = first.assessment.confidence;
    winningRoute = startRoute;

    const canEscalate =
      startRoute === "route_vision_qwen3_vl_8b_sf" &&
      shouldEscalateFromStandard(first.assessment);

    if (canEscalate) {
      escalated = true;
      attempts[attempts.length - 1]!.outcome = "escalated";
      const second = await runRoute("route_vision_qwen3_vl_32b_sf");
      understanding = extractUnderstandingText(second.call.text);
      confidence = second.assessment.confidence;
      winningRoute = "route_vision_qwen3_vl_32b_sf";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attempts.push({
      routeId: startRoute,
      need,
      outcome: "failed",
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      error: message,
    });
    // Soft-fail: do not block the employee reply if vision is down.
    console.warn("[AdeHQ vision] understanding failed", message);
    return null;
  }

  const promptBlock = buildVisionPromptBlock({
    text: understanding,
    routeId: winningRoute,
    confidence,
    escalated,
    assets,
  });

  return {
    text: understanding,
    routeId: winningRoute,
    need,
    confidence,
    escalated,
    attempts,
    assets: assets.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      source: a.source,
      provenance: a.provenance,
    })),
    promptBlock,
  };
}
