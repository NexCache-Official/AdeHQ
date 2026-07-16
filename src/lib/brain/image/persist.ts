import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DRIVE_BUCKETS } from "@/lib/drive/constants";
import { exportStoragePath } from "@/lib/drive/storage-sync";
import { recordStorageUsage } from "@/lib/drive/quota-server";
import { nowISO } from "@/lib/utils";
import type { ImageGenerationResult, ImageIntent } from "./types";
import { memberLabelForIntent } from "./select";

export type PersistedImageArtifact = {
  artifactId: string;
  exportId: string;
  versionNumber: number;
  title: string;
};

function provenanceMarkdown(params: {
  title: string;
  intent: ImageIntent;
  prompt: string;
  estimatedWh: number;
  employeeName?: string;
  parentArtifactId?: string | null;
  sourceFileId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  taskId?: string | null;
  brainRunId?: string | null;
  versionNumber: number;
}): string {
  const label = memberLabelForIntent(params.intent);
  return [
    `# ${params.title}`,
    "",
    `**Action:** ${label}`,
    `**Work Hours:** ~${params.estimatedWh} WH`,
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
    params.parentArtifactId ? `- Parent artifact: ${params.parentArtifactId}` : null,
    params.sourceFileId ? `- Source file: ${params.sourceFileId}` : null,
    params.roomId ? `- Room: ${params.roomId}` : null,
    params.topicId ? `- Topic: ${params.topicId}` : null,
    params.taskId ? `- Task: ${params.taskId}` : null,
    params.brainRunId ? `- Brain run: ${params.brainRunId}` : null,
    "",
    "_Model names are withheld from member views. Admins can inspect route ids in Control._",
  ]
    .filter((line) => line != null)
    .join("\n");
}

/**
 * Persist generated image as:
 * 1) markdown provenance artifact (+ version row)
 * 2) Drive binary export (PNG/WebP)
 * Linked for regenerate/edit and cross-employee reuse.
 */
export async function persistGeneratedImageArtifact(
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
    parentArtifactId?: string | null;
    sourceFileId?: string | null;
    title: string;
    generation: ImageGenerationResult;
  },
): Promise<PersistedImageArtifact> {
  const title = params.title.trim() || "Generated image";
  let artifactId = params.parentArtifactId ?? randomUUID();
  let versionNumber = 1;
  let isNew = !params.parentArtifactId;

  if (params.parentArtifactId) {
    const { data: existing, error } = await client
      .from("artifacts")
      .select("id, content_json, metadata")
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.parentArtifactId)
      .maybeSingle();
    if (error) throw error;
    if (!existing) {
      isNew = true;
      artifactId = randomUUID();
    } else {
      const { data: versions } = await client
        .from("artifact_versions")
        .select("version_number")
        .eq("artifact_id", artifactId)
        .order("version_number", { ascending: false })
        .limit(1);
      versionNumber = Number(versions?.[0]?.version_number ?? 0) + 1;
    }
  }

  const contentJson: Record<string, unknown> = {
    kind: "image",
    intent: params.generation.intent,
    memberLabel: params.generation.memberLabel,
    prompt: params.generation.prompt,
    estimatedWh: params.generation.estimatedWh,
    routeId: params.generation.routeId,
    mimeType: params.generation.mimeType,
    seed: params.generation.seed ?? null,
    parentArtifactId: params.parentArtifactId ?? null,
    sourceFileId: params.sourceFileId ?? null,
    taskId: params.taskId ?? null,
    brainRunId: params.brainRunId ?? null,
    workUnitId: params.workUnitId ?? null,
    versionNumber,
  };

  const contentMarkdown = provenanceMarkdown({
    title,
    intent: params.generation.intent,
    prompt: params.generation.prompt,
    estimatedWh: params.generation.estimatedWh,
    employeeName: params.employeeName,
    parentArtifactId: params.parentArtifactId,
    sourceFileId: params.sourceFileId,
    roomId: params.roomId,
    topicId: params.topicId,
    taskId: params.taskId,
    brainRunId: params.brainRunId,
    versionNumber,
  });

  if (isNew) {
    const { error } = await client.from("artifacts").insert({
      workspace_id: params.workspaceId,
      id: artifactId,
      room_id: params.roomId ?? null,
      topic_id: params.topicId ?? null,
      title: `${title} — AI source (image).md`,
      artifact_type: "image",
      status: "saved",
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
        binaryCompanion: true,
        sourceKind: "image",
        displayTitle: title,
        imageIntent: params.generation.intent,
        brainRunId: params.brainRunId ?? null,
        taskId: params.taskId ?? null,
      },
    });
    if (error) throw error;
  } else {
    const { error } = await client
      .from("artifacts")
      .update({
        title: `${title} — AI source (image).md`,
        content_markdown: contentMarkdown,
        content_json: contentJson,
        updated_at: nowISO(),
        metadata: {
          integrationGenerated: true,
          binaryCompanion: true,
          sourceKind: "image",
          displayTitle: title,
          imageIntent: params.generation.intent,
          brainRunId: params.brainRunId ?? null,
          taskId: params.taskId ?? null,
        },
      })
      .eq("id", artifactId)
      .eq("workspace_id", params.workspaceId);
    if (error) throw error;
  }

  await client.from("artifact_versions").insert({
    artifact_id: artifactId,
    version_number: versionNumber,
    content_markdown: contentMarkdown,
    content_json: contentJson,
    source_citations: [],
    created_by_type: "ai",
    created_by_id: params.employeeId,
  });

  const exportId = randomUUID();
  const ext = params.generation.mimeType.includes("webp") ? "webp" : "png";
  const storagePath = exportStoragePath(params.workspaceId, exportId, title, ext);

  const { error: uploadError } = await client.storage
    .from(DRIVE_BUCKETS.exports)
    .upload(storagePath, params.generation.bytes, {
      contentType: params.generation.mimeType || "image/png",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { error: exportError } = await client.from("drive_exports").insert({
    id: exportId,
    workspace_id: params.workspaceId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    created_by_user_id: null,
    title,
    export_type: "artifact_bundle",
    mime_type: params.generation.mimeType || "image/png",
    size_bytes: params.generation.bytes.byteLength,
    storage_bucket: DRIVE_BUCKETS.exports,
    storage_path: storagePath,
    source_artifact_ids: [artifactId],
    source_file_ids: params.sourceFileId ? [params.sourceFileId] : [],
    metadata: {
      kind: "image",
      intent: params.generation.intent,
      memberLabel: params.generation.memberLabel,
      versionNumber,
      prompt: params.generation.prompt,
      routeId: params.generation.routeId,
      brainRunId: params.brainRunId ?? null,
      parentArtifactId: params.parentArtifactId ?? null,
      generatedByEmployeeId: params.employeeId,
      fileExtension: ext,
      sourceArtifactId: artifactId,
      reusable: true,
    },
  });
  if (exportError) throw exportError;

  await client
    .from("artifacts")
    .update({
      content_json: { ...contentJson, exportId },
      metadata: {
        integrationGenerated: true,
        binaryCompanion: true,
        binaryExportId: exportId,
        binaryExportExt: ext,
        sourceKind: "image",
        displayTitle: title,
        imageIntent: params.generation.intent,
        brainRunId: params.brainRunId ?? null,
        taskId: params.taskId ?? null,
      },
    })
    .eq("id", artifactId)
    .eq("workspace_id", params.workspaceId);

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
  }).catch((error) => console.warn("[AdeHQ image] quota ledger failed", error));

  // Work-graph links for reuse across employees / rooms / tasks.
  const edges: Array<{
    fromObjectType: string;
    fromObjectId: string;
    relationType: string;
    toObjectType: string;
    toObjectId: string;
  }> = [
    {
      fromObjectType: "artifact",
      fromObjectId: artifactId,
      relationType: "produced_export",
      toObjectType: "drive_export",
      toObjectId: exportId,
    },
  ];
  if (params.triggerMessageId) {
    edges.push({
      fromObjectType: "message",
      fromObjectId: params.triggerMessageId,
      relationType: "created_artifact",
      toObjectType: "artifact",
      toObjectId: artifactId,
    });
  }
  if (params.taskId) {
    edges.push({
      fromObjectType: "task",
      fromObjectId: params.taskId,
      relationType: "produces_artifact",
      toObjectType: "artifact",
      toObjectId: artifactId,
    });
  }
  if (params.parentArtifactId && params.parentArtifactId !== artifactId) {
    edges.push({
      fromObjectType: "artifact",
      fromObjectId: params.parentArtifactId,
      relationType: "image_version_of",
      toObjectType: "artifact",
      toObjectId: artifactId,
    });
  }
  if (params.brainRunId) {
    edges.push({
      fromObjectType: "brain_run",
      fromObjectId: params.brainRunId,
      relationType: "metered_artifact",
      toObjectType: "artifact",
      toObjectId: artifactId,
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
        metadata: { kind: "image", intent: params.generation.intent },
      });
    } catch {
      /* non-fatal */
    }
  }

  return { artifactId, exportId, versionNumber, title };
}
