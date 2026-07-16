import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DRIVE_BUCKETS } from "@/lib/drive/constants";
import { exportStoragePath } from "@/lib/drive/storage-sync";
import { recordStorageUsage } from "@/lib/drive/quota-server";
import { nowISO } from "@/lib/utils";
import type { VideoArtifactStatus, VideoGenerationResult, VideoIntent } from "./types";
import { VIDEO_ESTIMATE_CARD_SUMMARY } from "./types";
import { memberLabelForVideoIntent } from "./select";

export type PersistedVideoArtifact = {
  artifactId: string;
  exportId: string | null;
  versionNumber: number;
  title: string;
  status: VideoArtifactStatus;
};

function provenanceMarkdown(params: {
  title: string;
  intent: VideoIntent;
  prompt: string;
  estimatedWh: number;
  status: VideoArtifactStatus;
  employeeName?: string;
  sourceFileId?: string | null;
  sourceArtifactId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  taskId?: string | null;
  brainRunId?: string | null;
  providerRequestId?: string | null;
  versionNumber: number;
}): string {
  const label = memberLabelForVideoIntent(params.intent);
  return [
    `# ${params.title}`,
    "",
    `**Action:** ${label}`,
    `**Estimate:** ${VIDEO_ESTIMATE_CARD_SUMMARY}`,
    `**Status:** ${params.status}`,
    `**Work Hours:** ${params.estimatedWh} WH`,
    `**Version:** ${params.versionNumber}`,
    params.employeeName ? `**Created by:** ${params.employeeName}` : null,
    "",
    "## Prompt",
    "",
    params.prompt.trim(),
    "",
    "## Provenance",
    "",
    `- Intent: ${params.intent}`,
    params.sourceArtifactId ? `- Source image artifact: ${params.sourceArtifactId}` : null,
    params.sourceFileId ? `- Source file: ${params.sourceFileId}` : null,
    params.roomId ? `- Room: ${params.roomId}` : null,
    params.topicId ? `- Topic: ${params.topicId}` : null,
    params.taskId ? `- Task: ${params.taskId}` : null,
    params.brainRunId ? `- Brain run: ${params.brainRunId}` : null,
    params.providerRequestId ? `- Provider request: ${params.providerRequestId}` : null,
    "",
    "_Model names are withheld from member views. Admins can inspect route ids in Control._",
  ]
    .filter((line) => line != null)
    .join("\n");
}

/** Create a processing placeholder artifact before provider work finishes. */
export async function createProcessingVideoArtifact(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    employeeName?: string;
    roomId?: string | null;
    topicId?: string | null;
    taskId?: string | null;
    triggerMessageId?: string | null;
    brainRunId?: string | null;
    workUnitId?: string | null;
    intent: VideoIntent;
    prompt: string;
    title: string;
    sourceFileId?: string | null;
    sourceArtifactId?: string | null;
    estimatedWh: number;
  },
): Promise<PersistedVideoArtifact> {
  const artifactId = randomUUID();
  const title = params.title.trim() || "Five-second video";
  const contentJson = {
    kind: "video",
    intent: params.intent,
    memberLabel: memberLabelForVideoIntent(params.intent),
    prompt: params.prompt,
    estimatedWh: params.estimatedWh,
    estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
    status: "processing" as VideoArtifactStatus,
    sourceFileId: params.sourceFileId ?? null,
    sourceArtifactId: params.sourceArtifactId ?? null,
    taskId: params.taskId ?? null,
    brainRunId: params.brainRunId ?? null,
    workUnitId: params.workUnitId ?? null,
    versionNumber: 1,
  };
  const contentMarkdown = provenanceMarkdown({
    title,
    intent: params.intent,
    prompt: params.prompt,
    estimatedWh: params.estimatedWh,
    status: "processing",
    employeeName: params.employeeName,
    sourceFileId: params.sourceFileId,
    sourceArtifactId: params.sourceArtifactId,
    roomId: params.roomId,
    topicId: params.topicId,
    taskId: params.taskId,
    brainRunId: params.brainRunId,
    versionNumber: 1,
  });

  const { error } = await client.from("artifacts").insert({
    workspace_id: params.workspaceId,
    id: artifactId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    title: `${title} — AI source (video).md`,
    artifact_type: "video",
    status: "draft",
    content_markdown: contentMarkdown,
    content_json: contentJson,
    created_by_type: "ai",
    created_by_id: params.employeeId,
    source_file_ids: params.sourceFileId ? [params.sourceFileId] : [],
    source_message_ids: params.triggerMessageId ? [params.triggerMessageId] : [],
    source_chunk_ids: [],
    source_citations: [],
    metadata: {
      integrationGenerated: true,
      sourceKind: "video",
      displayTitle: title,
      videoIntent: params.intent,
      mediaStatus: "processing",
      estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
      brainRunId: params.brainRunId ?? null,
      taskId: params.taskId ?? null,
      linkedImageArtifactId: params.sourceArtifactId ?? null,
    },
  });
  if (error) throw error;

  await client.from("artifact_versions").insert({
    artifact_id: artifactId,
    version_number: 1,
    content_markdown: contentMarkdown,
    content_json: contentJson,
    source_citations: [],
    created_by_type: "ai",
    created_by_id: params.employeeId,
  });

  return {
    artifactId,
    exportId: null,
    versionNumber: 1,
    title,
    status: "processing",
  };
}

export async function finalizeVideoArtifact(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    artifactId: string;
    title: string;
    generation: VideoGenerationResult;
    status: Extract<VideoArtifactStatus, "ready" | "failed" | "cancelled">;
    errorMessage?: string | null;
    roomId?: string | null;
    topicId?: string | null;
    taskId?: string | null;
    brainRunId?: string | null;
    sourceFileId?: string | null;
    sourceArtifactId?: string | null;
  },
): Promise<PersistedVideoArtifact> {
  let exportId: string | null = null;
  let versionNumber = 1;

  if (params.status === "ready") {
    exportId = randomUUID();
    const storagePath = exportStoragePath(
      params.workspaceId,
      exportId,
      params.title,
      "mp4",
    );
    const { error: uploadError } = await client.storage
      .from(DRIVE_BUCKETS.exports)
      .upload(storagePath, params.generation.bytes, {
        contentType: params.generation.mimeType || "video/mp4",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { error: exportError } = await client.from("drive_exports").insert({
      id: exportId,
      workspace_id: params.workspaceId,
      room_id: params.roomId ?? null,
      topic_id: params.topicId ?? null,
      created_by_user_id: null,
      title: params.title,
      export_type: "artifact_bundle",
      mime_type: params.generation.mimeType || "video/mp4",
      size_bytes: params.generation.bytes.byteLength,
      storage_bucket: DRIVE_BUCKETS.exports,
      storage_path: storagePath,
      source_artifact_ids: [params.artifactId],
      source_file_ids: params.sourceFileId ? [params.sourceFileId] : [],
      metadata: {
        kind: "video",
        intent: params.generation.intent,
        memberLabel: params.generation.memberLabel,
        mediaStatus: "ready",
        estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
        estimatedWh: params.generation.estimatedWh,
        prompt: params.generation.prompt,
        routeId: params.generation.routeId,
        providerRequestId: params.generation.providerRequestId,
        brainRunId: params.brainRunId ?? null,
        linkedImageArtifactId: params.sourceArtifactId ?? null,
        generatedByEmployeeId: params.employeeId,
        fileExtension: "mp4",
        sourceArtifactId: params.artifactId,
        reusable: true,
      },
    });
    if (exportError) throw exportError;

    await recordStorageUsage({
      workspaceId: params.workspaceId,
      userId: params.employeeId,
      eventType: "export",
      bucket: DRIVE_BUCKETS.exports,
      objectPath: storagePath,
      sizeBytes: params.generation.bytes.byteLength,
      deltaBytes: params.generation.bytes.byteLength,
      entityType: "export",
      entityId: exportId,
    }).catch((error) => console.warn("[AdeHQ video] quota ledger failed", error));
  }

  const contentJson = {
    kind: "video",
    intent: params.generation.intent,
    memberLabel: params.generation.memberLabel,
    prompt: params.generation.prompt,
    estimatedWh: params.generation.estimatedWh,
    estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
    status: params.status,
    exportId,
    mimeType: params.generation.mimeType,
    providerRequestId: params.generation.providerRequestId,
    sourceFileId: params.sourceFileId ?? null,
    sourceArtifactId: params.sourceArtifactId ?? null,
    taskId: params.taskId ?? null,
    brainRunId: params.brainRunId ?? null,
    errorMessage: params.errorMessage ?? null,
    versionNumber,
  };
  const contentMarkdown = provenanceMarkdown({
    title: params.title,
    intent: params.generation.intent,
    prompt: params.generation.prompt,
    estimatedWh: params.generation.estimatedWh,
    status: params.status,
    sourceFileId: params.sourceFileId,
    sourceArtifactId: params.sourceArtifactId,
    roomId: params.roomId,
    topicId: params.topicId,
    taskId: params.taskId,
    brainRunId: params.brainRunId,
    providerRequestId: params.generation.providerRequestId,
    versionNumber,
  });

  await client
    .from("artifacts")
    .update({
      status: params.status === "ready" ? "saved" : "draft",
      content_markdown: contentMarkdown,
      content_json: contentJson,
      updated_at: nowISO(),
      metadata: {
        integrationGenerated: true,
        binaryCompanion: params.status === "ready",
        binaryExportId: exportId,
        binaryExportExt: "mp4",
        sourceKind: "video",
        displayTitle: params.title,
        videoIntent: params.generation.intent,
        mediaStatus: params.status,
        estimateCard: VIDEO_ESTIMATE_CARD_SUMMARY,
        brainRunId: params.brainRunId ?? null,
        taskId: params.taskId ?? null,
        linkedImageArtifactId: params.sourceArtifactId ?? null,
        errorMessage: params.errorMessage ?? null,
      },
    })
    .eq("id", params.artifactId)
    .eq("workspace_id", params.workspaceId);

  await client.from("artifact_versions").insert({
    artifact_id: params.artifactId,
    version_number: 2,
    content_markdown: contentMarkdown,
    content_json: contentJson,
    source_citations: [],
    created_by_type: "ai",
    created_by_id: params.employeeId,
  });
  versionNumber = 2;

  if (params.status === "ready" && exportId) {
    const edges = [
      {
        fromObjectType: "artifact",
        fromObjectId: params.artifactId,
        relationType: "produced_export",
        toObjectType: "drive_export",
        toObjectId: exportId,
      },
    ];
    if (params.sourceArtifactId) {
      edges.push({
        fromObjectType: "artifact",
        fromObjectId: params.sourceArtifactId,
        relationType: "source_image_for_video",
        toObjectType: "artifact",
        toObjectId: params.artifactId,
      });
    }
    if (params.brainRunId) {
      edges.push({
        fromObjectType: "brain_run",
        fromObjectId: params.brainRunId,
        relationType: "metered_artifact",
        toObjectType: "artifact",
        toObjectId: params.artifactId,
      });
    }
    for (const edge of edges) {
      try {
        await client.from("work_graph_edges").insert({
          workspace_id: params.workspaceId,
          from_object_type: edge.fromObjectType,
          from_object_id: edge.fromObjectId,
          relation_type: edge.relationType,
          to_object_type: edge.toObjectType,
          to_object_id: edge.toObjectId,
          metadata: { kind: "video", intent: params.generation.intent },
        });
      } catch {
        /* non-fatal */
      }
    }
  }

  return {
    artifactId: params.artifactId,
    exportId,
    versionNumber,
    title: params.title,
    status: params.status,
  };
}
