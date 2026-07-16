import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { costUsdFromSnapshot } from "@/lib/brain/catalog/pricing-snapshots";
import { isBrainImageV1Enabled } from "@/lib/brain/flags";
import { recordBrainUsage } from "@/lib/brain/metering";
import { getWorkspaceCapacity } from "@/lib/billing/usage/periods";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import { callSiliconFlowImage } from "./adapter";
import { evaluateImageGenerationPolicy } from "./policy";
import { estimatedWhForIntent, memberLabelForIntent, routeIdForImageIntent } from "./select";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImagePolicyDecision,
  ImageRouteId,
} from "./types";

async function loadSourceImageDataUrl(
  client: SupabaseClient,
  workspaceId: string,
  request: ImageGenerationRequest,
): Promise<string | undefined> {
  if (request.intent !== "edit" && !request.sourceFileId && !request.sourceExportId) {
    return undefined;
  }

  if (request.sourceFileId) {
    const { data: file, error } = await client
      .from("workspace_files")
      .select("storage_bucket, storage_path, mime_type")
      .eq("workspace_id", workspaceId)
      .eq("id", request.sourceFileId)
      .maybeSingle();
    if (error) throw error;
    if (!file?.storage_bucket || !file.storage_path) {
      throw new Error("Source file not found for image edit.");
    }
    const { data: blob, error: dlError } = await client.storage
      .from(String(file.storage_bucket))
      .download(String(file.storage_path));
    if (dlError || !blob) throw new Error("Could not download source image.");
    const bytes = Buffer.from(await blob.arrayBuffer());
    const mime = String(file.mime_type || "image/png");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  if (request.sourceExportId) {
    const { data: exp, error } = await client
      .from("drive_exports")
      .select("storage_bucket, storage_path, mime_type")
      .eq("workspace_id", workspaceId)
      .eq("id", request.sourceExportId)
      .maybeSingle();
    if (error) throw error;
    if (!exp?.storage_path) throw new Error("Source export not found for image edit.");
    const bucket = String(exp.storage_bucket || "adehq-exports");
    const { data: blob, error: dlError } = await client.storage
      .from(bucket)
      .download(String(exp.storage_path));
    if (dlError || !blob) throw new Error("Could not download source export image.");
    const bytes = Buffer.from(await blob.arrayBuffer());
    const mime = String(exp.mime_type || "image/png");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  if (request.sourceArtifactId || request.parentArtifactId) {
    const artifactId = request.sourceArtifactId || request.parentArtifactId!;
    const { data: artifact, error } = await client
      .from("artifacts")
      .select("metadata, content_json")
      .eq("workspace_id", workspaceId)
      .eq("id", artifactId)
      .maybeSingle();
    if (error) throw error;
    const meta = (artifact?.metadata ?? {}) as Record<string, unknown>;
    const json = (artifact?.content_json ?? {}) as Record<string, unknown>;
    const exportId =
      (typeof meta.binaryExportId === "string" && meta.binaryExportId) ||
      (typeof json.exportId === "string" && json.exportId) ||
      null;
    if (!exportId) {
      throw new Error("Source artifact has no linked image export to edit.");
    }
    return loadSourceImageDataUrl(client, workspaceId, {
      ...request,
      sourceExportId: exportId,
      sourceArtifactId: undefined,
      parentArtifactId: undefined,
    });
  }

  return undefined;
}

export async function assessImageGenerationRequest(
  client: SupabaseClient,
  workspaceId: string,
  request: ImageGenerationRequest,
): Promise<ImagePolicyDecision> {
  const capacity = await getWorkspaceCapacity(client, workspaceId);
  return evaluateImageGenerationPolicy({
    intent: request.intent,
    remainingWh: capacity.remaining,
    unlimited: capacity.unlimited,
    warningLevel: capacity.warningLevel,
    confirmed: request.confirmed,
  });
}

export async function executeImageGeneration(params: {
  client: SupabaseClient;
  workspaceId: string;
  request: ImageGenerationRequest;
  employeeId?: string | null;
  userId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  workUnitId?: string | null;
  brainRunId?: string | null;
  messageId?: string | null;
  skipPolicy?: boolean;
}): Promise<{ policy: ImagePolicyDecision; result?: ImageGenerationResult }> {
  if (!isBrainImageV1Enabled()) {
    return {
      policy: {
        action: "blocked",
        estimatedWh: estimatedWhForIntent(params.request.intent),
        memberLabel: memberLabelForIntent(params.request.intent),
        remainingWh: null,
        reason: "Image creation is turned off for this environment.",
      },
    };
  }

  const policy = params.skipPolicy
    ? {
        action: "proceed" as const,
        estimatedWh: estimatedWhForIntent(params.request.intent),
        memberLabel: memberLabelForIntent(params.request.intent),
        remainingWh: null,
      }
    : await assessImageGenerationRequest(params.client, params.workspaceId, params.request);

  if (policy.action !== "proceed") {
    return { policy };
  }

  const routeId: ImageRouteId = routeIdForImageIntent(params.request.intent);
  const sourceImageDataUrl = await loadSourceImageDataUrl(
    params.client,
    params.workspaceId,
    params.request,
  );
  if (params.request.intent === "edit" && !sourceImageDataUrl) {
    throw new Error("Edit image requires a source file, export, or prior image artifact.");
  }

  const call = await callSiliconFlowImage({
    routeId,
    prompt: params.request.prompt,
    negativePrompt: params.request.negativePrompt,
    imageSize: params.request.imageSize,
    sourceImageDataUrl,
  });

  const snap = getLiveSeedSnapshot(routeId);
  const costUsd = snap
    ? costUsdFromSnapshot(snap, { imageCount: 1 })
    : estimatedWhForIntent(params.request.intent) * 0.01;

  await recordBrainUsage({
    client: params.client,
    workspaceId: params.workspaceId,
    idempotencyKey: `${params.workUnitId ?? params.brainRunId ?? params.messageId ?? "image"}:image:${routeId}:${Date.now()}`,
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
      imageCount: 1,
      inputTokens: 0,
      outputTokens: 0,
    },
    status: "succeeded",
    billableToWorkspace: true,
    providerCalled: true,
    workType: params.request.intent === "edit" ? "image_edit" : "image_generation",
    capability: params.request.intent === "edit" ? "image_edit" : "image_generation",
    runtimeMode: "multimodal",
    metadata: {
      routeId,
      imageIntent: params.request.intent,
      memberLabel: policy.memberLabel,
      promptChars: params.request.prompt.length,
      latencyMs: call.latencyMs,
      workHours: workHoursFromCost(costUsd),
      parentArtifactId: params.request.parentArtifactId ?? null,
      sourceFileId: params.request.sourceFileId ?? null,
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
      bytes: call.bytes,
      mimeType: call.mimeType,
      latencyMs: call.latencyMs,
      seed: call.seed,
    },
  };
}
