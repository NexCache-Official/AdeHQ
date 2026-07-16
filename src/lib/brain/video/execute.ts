import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { costUsdFromSnapshot } from "@/lib/brain/catalog/pricing-snapshots";
import { isBrainVideoV1Enabled } from "@/lib/brain/flags";
import { recordBrainUsage } from "@/lib/brain/metering";
import { getWorkspaceCapacity } from "@/lib/billing/usage/periods";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import {
  downloadVideoBytes,
  pollSiliconFlowVideoUntilDone,
  submitSiliconFlowVideo,
} from "./adapter";
import { evaluateVideoGenerationPolicy } from "./policy";
import {
  estimatedWhForVideo,
  memberLabelForVideoIntent,
  routeIdForVideoIntent,
} from "./select";
import type {
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoPolicyDecision,
  VideoRouteId,
} from "./types";
import { VIDEO_ESTIMATE_CARD_SUMMARY } from "./types";

async function loadSourceImageDataUrl(
  client: SupabaseClient,
  workspaceId: string,
  request: VideoGenerationRequest,
): Promise<string | undefined> {
  if (request.intent !== "image_to_video") return undefined;

  if (request.sourceFileId) {
    const { data: file, error } = await client
      .from("workspace_files")
      .select("storage_bucket, storage_path, mime_type")
      .eq("workspace_id", workspaceId)
      .eq("id", request.sourceFileId)
      .maybeSingle();
    if (error) throw error;
    if (!file?.storage_bucket || !file.storage_path) {
      throw new Error("Source file not found for image-to-video.");
    }
    const { data: blob, error: dlError } = await client.storage
      .from(String(file.storage_bucket))
      .download(String(file.storage_path));
    if (dlError || !blob) throw new Error("Could not download source image.");
    const bytes = Buffer.from(await blob.arrayBuffer());
    const mime = String(file.mime_type || "image/png");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  if (request.sourceExportId || request.sourceArtifactId) {
    let exportId = request.sourceExportId ?? null;
    if (!exportId && request.sourceArtifactId) {
      const { data: artifact, error } = await client
        .from("artifacts")
        .select("metadata, content_json")
        .eq("workspace_id", workspaceId)
        .eq("id", request.sourceArtifactId)
        .maybeSingle();
      if (error) throw error;
      const meta = (artifact?.metadata ?? {}) as Record<string, unknown>;
      const json = (artifact?.content_json ?? {}) as Record<string, unknown>;
      exportId =
        (typeof meta.binaryExportId === "string" && meta.binaryExportId) ||
        (typeof json.exportId === "string" && json.exportId) ||
        null;
    }
    if (!exportId) throw new Error("Source artifact has no linked image export.");
    const { data: exp, error } = await client
      .from("drive_exports")
      .select("storage_bucket, storage_path, mime_type")
      .eq("workspace_id", workspaceId)
      .eq("id", exportId)
      .maybeSingle();
    if (error) throw error;
    if (!exp?.storage_path) throw new Error("Source export not found.");
    const bucket = String(exp.storage_bucket || "adehq-exports");
    const { data: blob, error: dlError } = await client.storage
      .from(bucket)
      .download(String(exp.storage_path));
    if (dlError || !blob) throw new Error("Could not download source export image.");
    const bytes = Buffer.from(await blob.arrayBuffer());
    const mime = String(exp.mime_type || "image/png");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  throw new Error("Image-to-video requires sourceFileId, sourceArtifactId, or sourceExportId.");
}

export async function assessVideoGenerationRequest(
  client: SupabaseClient,
  workspaceId: string,
  request: VideoGenerationRequest,
): Promise<VideoPolicyDecision> {
  const capacity = await getWorkspaceCapacity(client, workspaceId);
  return evaluateVideoGenerationPolicy({
    intent: request.intent,
    remainingWh: capacity.remaining,
    unlimited: capacity.unlimited,
    warningLevel: capacity.warningLevel,
    enabled: isBrainVideoV1Enabled(),
  });
}

export async function executeVideoGeneration(params: {
  client: SupabaseClient;
  workspaceId: string;
  request: VideoGenerationRequest;
  employeeId?: string | null;
  userId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  workUnitId?: string | null;
  brainRunId?: string | null;
  messageId?: string | null;
  jobId?: string | null;
  skipPolicy?: boolean;
  onProviderRequestId?: (requestId: string) => Promise<void>;
  shouldCancel?: () => Promise<boolean>;
  onProviderStatus?: (status: string) => Promise<void>;
}): Promise<{ policy: VideoPolicyDecision; result?: VideoGenerationResult }> {
  const policy = params.skipPolicy
    ? {
        action: "proceed" as const,
        estimatedWh: estimatedWhForVideo(),
        memberLabel: memberLabelForVideoIntent(params.request.intent),
        remainingWh: null,
        estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
      }
    : await assessVideoGenerationRequest(params.client, params.workspaceId, params.request);

  if (policy.action !== "proceed") {
    return { policy };
  }

  const routeId: VideoRouteId = routeIdForVideoIntent(params.request.intent);
  const sourceImageDataUrl = await loadSourceImageDataUrl(
    params.client,
    params.workspaceId,
    params.request,
  );

  const started = Date.now();
  const submitted = await submitSiliconFlowVideo({
    routeId,
    prompt: params.request.prompt,
    negativePrompt: params.request.negativePrompt,
    imageSize: params.request.imageSize,
    sourceImageDataUrl,
  });
  await params.onProviderRequestId?.(submitted.requestId);

  const finalStatus = await pollSiliconFlowVideoUntilDone({
    requestId: submitted.requestId,
    shouldCancel: params.shouldCancel,
    onStatus: async (status) => {
      await params.onProviderStatus?.(status);
    },
  });

  if (finalStatus.reason === "cancelled" || (await params.shouldCancel?.())) {
    return {
      policy: {
        ...policy,
        action: "blocked_disabled",
        reason: "Video generation was cancelled.",
      },
    };
  }

  if (finalStatus.status !== "Succeed" || !finalStatus.videoUrl) {
    throw new Error(
      finalStatus.reason || "Video generation failed before a downloadable result was ready.",
    );
  }

  const downloaded = await downloadVideoBytes(finalStatus.videoUrl);
  const snap = getLiveSeedSnapshot(routeId);
  const costUsd = snap
    ? costUsdFromSnapshot(snap, { videoCount: 1 })
    : estimatedWhForVideo() * 0.01;

  await recordBrainUsage({
    client: params.client,
    workspaceId: params.workspaceId,
    idempotencyKey: `${params.workUnitId ?? params.jobId ?? params.messageId ?? "video"}:video:${routeId}:${submitted.requestId}`,
    employeeId: params.employeeId,
    userId: params.userId,
    workUnitId: params.workUnitId,
    brainRunId: params.brainRunId,
    roomId: params.roomId,
    topicId: params.topicId,
    messageId: params.messageId,
    sourceType: "artifact",
    routeId,
    usage: {
      videoCount: 1,
      inputTokens: 0,
      outputTokens: 0,
    },
    status: "succeeded",
    billableToWorkspace: true,
    providerCalled: true,
    workType: "video_generation",
    capability: "video_generation",
    runtimeMode: "multimodal",
    metadata: {
      routeId,
      videoIntent: params.request.intent,
      memberLabel: policy.memberLabel,
      providerRequestId: submitted.requestId,
      latencyMs: Date.now() - started,
      workHours: workHoursFromCost(costUsd),
      estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
      sourceFileId: params.request.sourceFileId ?? null,
      sourceArtifactId: params.request.sourceArtifactId ?? null,
      taskId: params.request.taskId ?? null,
    },
  });

  return {
    policy,
    result: {
      intent: params.request.intent,
      routeId,
      memberLabel: policy.memberLabel,
      estimatedWh: policy.estimatedWh,
      costUsd,
      prompt: params.request.prompt,
      bytes: downloaded.bytes,
      mimeType: downloaded.mimeType.startsWith("video/") ? downloaded.mimeType : "video/mp4",
      latencyMs: Date.now() - started,
      providerRequestId: submitted.requestId,
      seed: finalStatus.seed,
      sourceFileId: params.request.sourceFileId ?? null,
      sourceArtifactId: params.request.sourceArtifactId ?? null,
    },
  };
}
