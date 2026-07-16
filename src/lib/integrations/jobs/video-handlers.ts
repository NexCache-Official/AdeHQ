// PR-17 — Async video create jobs (approval already verified before enqueue).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { registerJobHandler, type JobHandlerResult } from "./registry";
import {
  assessVideoGenerationRequest,
  createProcessingVideoArtifact,
  executeVideoGeneration,
  finalizeVideoArtifact,
  VIDEO_ESTIMATE_CARD_SUMMARY,
  type VideoGenerationResult,
} from "@/lib/brain/video";
import type { CreateVideoArgs } from "@/lib/integrations/registry/tool-definitions";
import { uid, nowISO } from "@/lib/utils";

type JobPayload = {
  tool?: string;
  args?: Record<string, unknown>;
  ctx?: {
    roomId?: string;
    topicId?: string;
    employeeId?: string;
    employeeName?: string;
    triggerMessageId?: string;
    brainRunId?: string;
    workUnitId?: string;
  };
};

async function resolveEmployeeName(
  client: SupabaseClient,
  workspaceId: string,
  ctx: JobPayload["ctx"],
  employeeId: string,
): Promise<string> {
  if (ctx?.employeeName) return ctx.employeeName;
  const { data } = await client
    .from("ai_employees")
    .select("name")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  return data?.name ? String(data.name) : "AdeHQ AI employee";
}

async function isJobCancelRequested(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
): Promise<boolean> {
  const { data } = await client
    .from("integration_jobs")
    .select("status, payload")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return false;
  if (data.status === "cancelled") return true;
  const payload = (data.payload ?? {}) as Record<string, unknown>;
  return Boolean(payload.cancelRequested);
}

async function patchJobPayload(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
  patch: Record<string, unknown>,
) {
  const { data } = await client
    .from("integration_jobs")
    .select("payload")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();
  const prev = (data?.payload ?? {}) as Record<string, unknown>;
  await client
    .from("integration_jobs")
    .update({
      payload: { ...prev, ...patch },
      updated_at: nowISO(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", jobId);
}

async function writeVideoWorkLog(
  client: SupabaseClient,
  job: IntegrationJobRecord,
  params: { action: string; summary: string; artifactId: string },
) {
  const ctx = (job.payload as JobPayload).ctx;
  if (!ctx?.roomId || !job.employeeId) return;
  await client.from("work_log_events").insert({
    workspace_id: job.workspaceId,
    id: uid("wl"),
    room_id: ctx.roomId,
    topic_id: ctx.topicId ?? null,
    employee_id: job.employeeId,
    action: params.action,
    summary: params.summary,
    tool_used: "video.create",
    status: "success",
    related_entity_type: "artifact",
    related_entity_id: params.artifactId,
    created_at: nowISO(),
  });
}

async function handleVideoCreateJob(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<JobHandlerResult> {
  const payload = job.payload as JobPayload;
  const args = payload.args as CreateVideoArgs;
  const ctx = payload.ctx ?? {};
  const employeeId = job.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new Error("Missing employee for video job.");

  const request = {
    intent: args.intent,
    prompt: args.prompt,
    title: args.title,
    negativePrompt: args.negativePrompt,
    imageSize: args.imageSize,
    sourceFileId: args.sourceFileId,
    sourceArtifactId: args.sourceArtifactId,
    sourceExportId: args.sourceExportId,
    taskId: args.taskId,
  };

  const policy = await assessVideoGenerationRequest(client, job.workspaceId, request);
  if (policy.action !== "proceed") {
    throw new Error(
      `${policy.reason ?? "Video blocked by Work Hours policy."}\n\n${VIDEO_ESTIMATE_CARD_SUMMARY}`,
    );
  }

  const employeeName = await resolveEmployeeName(client, job.workspaceId, ctx, employeeId);
  const title = args.title?.trim() || "Five-second video";
  const placeholder = await createProcessingVideoArtifact(client, {
    workspaceId: job.workspaceId,
    employeeId,
    employeeName,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    taskId: args.taskId,
    triggerMessageId: ctx.triggerMessageId,
    brainRunId: ctx.brainRunId,
    workUnitId: ctx.workUnitId ?? job.id,
    intent: args.intent,
    prompt: args.prompt,
    title,
    sourceFileId: args.sourceFileId,
    sourceArtifactId: args.sourceArtifactId,
    estimatedWh: policy.estimatedWh,
  });

  await patchJobPayload(client, job.workspaceId, job.id, {
    artifactId: placeholder.artifactId,
    mediaStatus: "processing",
    estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
  });

  try {
    const outcome = await executeVideoGeneration({
      client,
      workspaceId: job.workspaceId,
      request,
      employeeId,
      roomId: ctx.roomId,
      topicId: ctx.topicId,
      messageId: ctx.triggerMessageId,
      brainRunId: ctx.brainRunId,
      workUnitId: ctx.workUnitId ?? job.id,
      jobId: job.id,
      skipPolicy: true,
      onProviderRequestId: async (requestId) => {
        await patchJobPayload(client, job.workspaceId, job.id, {
          providerRequestId: requestId,
          mediaStatus: "processing",
        });
      },
      shouldCancel: () => isJobCancelRequested(client, job.workspaceId, job.id),
      onProviderStatus: async (status) => {
        await patchJobPayload(client, job.workspaceId, job.id, {
          providerStatus: status,
          mediaStatus: status === "Failed" ? "failed" : "processing",
        });
      },
    });

    if (!outcome.result) {
      const cancelled = await isJobCancelRequested(client, job.workspaceId, job.id);
      const stub: VideoGenerationResult = {
        intent: args.intent,
        routeId:
          args.intent === "image_to_video"
            ? "route_video_wan22_i2v"
            : "route_video_wan22_t2v",
        memberLabel: policy.memberLabel,
        estimatedWh: policy.estimatedWh,
        costUsd: 0,
        prompt: args.prompt,
        bytes: Buffer.alloc(0),
        mimeType: "video/mp4",
        latencyMs: 0,
        providerRequestId: String(
          ((await client
            .from("integration_jobs")
            .select("payload")
            .eq("id", job.id)
            .maybeSingle()).data?.payload as Record<string, unknown> | undefined)
            ?.providerRequestId ?? "",
        ),
        sourceFileId: args.sourceFileId,
        sourceArtifactId: args.sourceArtifactId,
      };
      await finalizeVideoArtifact(client, {
        workspaceId: job.workspaceId,
        employeeId,
        artifactId: placeholder.artifactId,
        title,
        generation: stub,
        status: cancelled ? "cancelled" : "failed",
        errorMessage: outcome.policy.reason ?? "Video generation did not complete.",
        roomId: ctx.roomId,
        topicId: ctx.topicId,
        taskId: args.taskId,
        brainRunId: ctx.brainRunId,
        sourceFileId: args.sourceFileId,
        sourceArtifactId: args.sourceArtifactId,
      });
      if (cancelled) {
        return {
          result: {
            artifactId: placeholder.artifactId,
            title,
            status: "cancelled",
            mediaStatus: "cancelled",
            estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
          },
          costUsd: 0,
          summary: `Cancelled video "${title}".`,
        };
      }
      throw new Error(outcome.policy.reason ?? "Video generation failed.");
    }

    const persisted = await finalizeVideoArtifact(client, {
      workspaceId: job.workspaceId,
      employeeId,
      artifactId: placeholder.artifactId,
      title,
      generation: outcome.result,
      status: "ready",
      roomId: ctx.roomId,
      topicId: ctx.topicId,
      taskId: args.taskId,
      brainRunId: ctx.brainRunId,
      sourceFileId: args.sourceFileId,
      sourceArtifactId: args.sourceArtifactId,
    });

    const summary = `${outcome.result.memberLabel} "${persisted.title}" ready — ${VIDEO_ESTIMATE_CARD_SUMMARY}`;
    await writeVideoWorkLog(client, job, {
      action: "video_created",
      summary,
      artifactId: persisted.artifactId,
    });

    return {
      result: {
        artifactId: persisted.artifactId,
        exportId: persisted.exportId,
        title: persisted.title,
        versionNumber: persisted.versionNumber,
        intent: args.intent,
        estimatedWh: outcome.result.estimatedWh,
        memberLabel: outcome.result.memberLabel,
        status: "ready",
        mediaStatus: "ready",
        estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
      },
      costUsd: outcome.result.costUsd,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled =
      /cancelled/i.test(message) ||
      (await isJobCancelRequested(client, job.workspaceId, job.id));
    const stub: VideoGenerationResult = {
      intent: args.intent,
      routeId:
        args.intent === "image_to_video"
          ? "route_video_wan22_i2v"
          : "route_video_wan22_t2v",
      memberLabel: policy.memberLabel,
      estimatedWh: policy.estimatedWh,
      costUsd: 0,
      prompt: args.prompt,
      bytes: Buffer.alloc(0),
      mimeType: "video/mp4",
      latencyMs: 0,
      providerRequestId: "",
      sourceFileId: args.sourceFileId,
      sourceArtifactId: args.sourceArtifactId,
    };
    await finalizeVideoArtifact(client, {
      workspaceId: job.workspaceId,
      employeeId,
      artifactId: placeholder.artifactId,
      title,
      generation: stub,
      status: cancelled ? "cancelled" : "failed",
      errorMessage: message,
      roomId: ctx.roomId,
      topicId: ctx.topicId,
      taskId: args.taskId,
      brainRunId: ctx.brainRunId,
      sourceFileId: args.sourceFileId,
      sourceArtifactId: args.sourceArtifactId,
    }).catch(() => undefined);

    if (cancelled) {
      return {
        result: {
          artifactId: placeholder.artifactId,
          title,
          status: "cancelled",
          mediaStatus: "cancelled",
          estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
        },
        costUsd: 0,
        summary: `Cancelled video "${title}".`,
      };
    }
    throw error;
  }
}

registerJobHandler("video_create", handleVideoCreateJob);
