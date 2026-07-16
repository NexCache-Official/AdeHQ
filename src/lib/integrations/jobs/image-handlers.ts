// PR-16 — Image create / edit / regenerate async jobs → Drive artifacts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { registerJobHandler, type JobHandlerResult } from "./registry";
import {
  executeImageGeneration,
  persistGeneratedImageArtifact,
  type ImageIntent,
} from "@/lib/brain/image";
import { formatImageTierOptions } from "@/lib/brain/image/policy";
import type {
  CreateImageArgs,
  EditImageArgs,
  RegenerateImageArgs,
} from "@/lib/integrations/registry/tool-definitions";
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

function throwPolicyGate(policy: {
  action: string;
  reason?: string;
  estimatedWh: number;
  memberLabel: string;
}): never {
  const tiers = formatImageTierOptions();
  const reason =
    policy.reason ??
    `${policy.memberLabel} needs confirmation before generating (~${policy.estimatedWh} WH).`;
  throw new Error(
    `${reason}\n\nFair options (no model names):\n${tiers}\n\nWhen the human agrees, retry with confirmed:true.`,
  );
}

async function writeImageWorkLog(
  client: SupabaseClient,
  job: IntegrationJobRecord,
  params: { action: string; summary: string; artifactId: string; toolName: string },
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
    tool_used: params.toolName,
    status: "success",
    related_entity_type: "artifact",
    related_entity_id: params.artifactId,
    created_at: nowISO(),
  });
}

async function handleImageCreateJob(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<JobHandlerResult> {
  const payload = job.payload as JobPayload;
  const args = payload.args as CreateImageArgs;
  const ctx = payload.ctx ?? {};
  const employeeId = job.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new Error("Missing employee for image job.");

  const outcome = await executeImageGeneration({
    client,
    workspaceId: job.workspaceId,
    request: {
      intent: args.intent,
      prompt: args.prompt,
      title: args.title,
      negativePrompt: args.negativePrompt,
      imageSize: args.imageSize,
      taskId: args.taskId,
      confirmed: args.confirmed,
    },
    employeeId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    messageId: ctx.triggerMessageId,
    brainRunId: ctx.brainRunId,
    workUnitId: ctx.workUnitId ?? job.id,
  });

  if (!outcome.result || outcome.policy.action !== "proceed") {
    throwPolicyGate(outcome.policy);
  }

  const employeeName = await resolveEmployeeName(client, job.workspaceId, ctx, employeeId);
  const persisted = await persistGeneratedImageArtifact(client, {
    workspaceId: job.workspaceId,
    employeeId,
    employeeName,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    taskId: args.taskId,
    triggerMessageId: ctx.triggerMessageId,
    brainRunId: ctx.brainRunId,
    workUnitId: ctx.workUnitId ?? job.id,
    title: args.title?.trim() || outcome.result.memberLabel,
    generation: outcome.result,
  });

  const summary = `${outcome.result.memberLabel} "${persisted.title}" v${persisted.versionNumber} — saved to Drive (~${outcome.result.estimatedWh} WH).`;
  await writeImageWorkLog(client, job, {
    action: "image_created",
    summary,
    artifactId: persisted.artifactId,
    toolName: "image.create",
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
    },
    costUsd: outcome.result.costUsd,
    summary,
  };
}

async function handleImageEditJob(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<JobHandlerResult> {
  const payload = job.payload as JobPayload;
  const args = payload.args as EditImageArgs;
  const ctx = payload.ctx ?? {};
  const employeeId = job.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new Error("Missing employee for image edit job.");

  const outcome = await executeImageGeneration({
    client,
    workspaceId: job.workspaceId,
    request: {
      intent: "edit",
      prompt: args.prompt,
      title: args.title,
      sourceFileId: args.sourceFileId,
      sourceArtifactId: args.sourceArtifactId,
      sourceExportId: args.sourceExportId,
      parentArtifactId: args.parentArtifactId ?? args.sourceArtifactId,
      taskId: args.taskId,
      confirmed: args.confirmed,
    },
    employeeId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    messageId: ctx.triggerMessageId,
    brainRunId: ctx.brainRunId,
    workUnitId: ctx.workUnitId ?? job.id,
  });

  if (!outcome.result || outcome.policy.action !== "proceed") {
    throwPolicyGate(outcome.policy);
  }

  const employeeName = await resolveEmployeeName(client, job.workspaceId, ctx, employeeId);
  const persisted = await persistGeneratedImageArtifact(client, {
    workspaceId: job.workspaceId,
    employeeId,
    employeeName,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    taskId: args.taskId,
    triggerMessageId: ctx.triggerMessageId,
    brainRunId: ctx.brainRunId,
    workUnitId: ctx.workUnitId ?? job.id,
    parentArtifactId: args.parentArtifactId ?? args.sourceArtifactId,
    sourceFileId: args.sourceFileId,
    title: args.title?.trim() || "Edited image",
    generation: outcome.result,
  });

  const summary = `Edit image "${persisted.title}" v${persisted.versionNumber} — saved to Drive (~${outcome.result.estimatedWh} WH).`;
  await writeImageWorkLog(client, job, {
    action: "image_edited",
    summary,
    artifactId: persisted.artifactId,
    toolName: "image.edit",
  });

  return {
    result: {
      artifactId: persisted.artifactId,
      exportId: persisted.exportId,
      title: persisted.title,
      versionNumber: persisted.versionNumber,
      intent: "edit" satisfies ImageIntent,
      estimatedWh: outcome.result.estimatedWh,
      memberLabel: outcome.result.memberLabel,
    },
    costUsd: outcome.result.costUsd,
    summary,
  };
}

async function handleImageRegenerateJob(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<JobHandlerResult> {
  const payload = job.payload as JobPayload;
  const args = payload.args as RegenerateImageArgs;
  const ctx = payload.ctx ?? {};
  const employeeId = job.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new Error("Missing employee for image regenerate job.");

  const { data: parent, error } = await client
    .from("artifacts")
    .select("id, title, content_json, metadata")
    .eq("workspace_id", job.workspaceId)
    .eq("id", args.parentArtifactId)
    .maybeSingle();
  if (error) throw error;
  if (!parent) throw new Error("Parent image artifact not found.");

  const json = (parent.content_json ?? {}) as Record<string, unknown>;
  const intent = (args.intent ??
    (typeof json.intent === "string" ? json.intent : "quick")) as
    | "quick"
    | "business_graphic"
    | "premium";
  const prompt =
    args.prompt?.trim() ||
    (typeof json.prompt === "string" ? json.prompt : "") ||
    "Regenerate with the same brief, improved clarity.";

  const outcome = await executeImageGeneration({
    client,
    workspaceId: job.workspaceId,
    request: {
      intent,
      prompt,
      title: args.title,
      parentArtifactId: args.parentArtifactId,
      taskId: args.taskId,
      confirmed: args.confirmed,
    },
    employeeId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    messageId: ctx.triggerMessageId,
    brainRunId: ctx.brainRunId,
    workUnitId: ctx.workUnitId ?? job.id,
  });

  if (!outcome.result || outcome.policy.action !== "proceed") {
    throwPolicyGate(outcome.policy);
  }

  const employeeName = await resolveEmployeeName(client, job.workspaceId, ctx, employeeId);
  const displayTitle =
    args.title?.trim() ||
    (typeof (parent.metadata as Record<string, unknown>)?.displayTitle === "string"
      ? String((parent.metadata as Record<string, unknown>).displayTitle)
      : "Generated image");

  const persisted = await persistGeneratedImageArtifact(client, {
    workspaceId: job.workspaceId,
    employeeId,
    employeeName,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    taskId: args.taskId,
    triggerMessageId: ctx.triggerMessageId,
    brainRunId: ctx.brainRunId,
    workUnitId: ctx.workUnitId ?? job.id,
    parentArtifactId: args.parentArtifactId,
    title: displayTitle,
    generation: outcome.result,
  });

  const summary = `Regenerated "${persisted.title}" v${persisted.versionNumber} — saved to Drive (~${outcome.result.estimatedWh} WH).`;
  await writeImageWorkLog(client, job, {
    action: "image_regenerated",
    summary,
    artifactId: persisted.artifactId,
    toolName: "image.regenerate",
  });

  return {
    result: {
      artifactId: persisted.artifactId,
      exportId: persisted.exportId,
      title: persisted.title,
      versionNumber: persisted.versionNumber,
      intent,
      estimatedWh: outcome.result.estimatedWh,
      memberLabel: outcome.result.memberLabel,
    },
    costUsd: outcome.result.costUsd,
    summary,
  };
}

registerJobHandler("image_create", handleImageCreateJob);
registerJobHandler("image_edit", handleImageEditJob);
registerJobHandler("image_regenerate", handleImageRegenerateJob);
