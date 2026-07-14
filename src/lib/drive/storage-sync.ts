import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SavedArtifact } from "@/lib/types";
import { DRIVE_BUCKETS } from "@/lib/drive/constants";
import { recordStorageUsage } from "@/lib/drive/quota-server";
import { sanitizeFileName } from "@/lib/files/sanitize-file-name";

export function artifactStoragePath(workspaceId: string, artifactId: string, title: string): string {
  const safe = sanitizeFileName(title).replace(/\.md$/i, "") || "artifact";
  return `${workspaceId}/artifacts/${artifactId}/${safe}.md`;
}

export function exportStoragePath(workspaceId: string, exportId: string, title: string, ext: string): string {
  const safe = sanitizeFileName(title).replace(/\.[^.]+$/, "") || "export";
  return `${workspaceId}/exports/${exportId}/${safe}.${ext}`;
}

export function evidenceStoragePath(workspaceId: string, evidenceId: string, fileName: string): string {
  const safe = sanitizeFileName(fileName);
  return `${workspaceId}/evidence/${evidenceId}/${safe}`;
}

export async function syncArtifactToStorage(
  client: SupabaseClient,
  artifact: Pick<
    SavedArtifact,
    "id" | "workspaceId" | "title" | "contentMarkdown" | "metadata" | "driveFolderId"
  >,
  userId?: string | null,
): Promise<{ storagePath: string; sizeBytes: number }> {
  const storagePath = artifactStoragePath(artifact.workspaceId, artifact.id, artifact.title);
  const body = Buffer.from(artifact.contentMarkdown, "utf8");
  const previousPath =
    typeof artifact.metadata?.storagePath === "string" ? artifact.metadata.storagePath : null;
  const previousSize = Number(artifact.metadata?.storageBytes ?? 0);

  const { error: uploadError } = await client.storage
    .from(DRIVE_BUCKETS.artifacts)
    .upload(storagePath, body, {
      contentType: "text/markdown",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const sizeBytes = body.byteLength;
  const metadata = {
    ...artifact.metadata,
    storageBucket: DRIVE_BUCKETS.artifacts,
    storagePath,
    storageBytes: sizeBytes,
    storageSyncedAt: new Date().toISOString(),
  };

  const { error: updateError } = await client
    .from("artifacts")
    .update({ metadata })
    .eq("workspace_id", artifact.workspaceId)
    .eq("id", artifact.id);
  if (updateError) throw updateError;

  const delta = previousPath === storagePath ? sizeBytes - previousSize : sizeBytes;
  if (delta !== 0) {
    await recordStorageUsage({
      workspaceId: artifact.workspaceId,
      userId,
      eventType: previousPath ? "artifact_save" : "artifact_save",
      bucket: DRIVE_BUCKETS.artifacts,
      objectPath: storagePath,
      sizeBytes,
      deltaBytes: delta,
      entityType: "artifact",
      entityId: artifact.id,
    }).catch(() => undefined);
  }

  return { storagePath, sizeBytes };
}

export async function backfillArtifactStorage(
  client: SupabaseClient,
  workspaceId: string,
  userId?: string | null,
  limit = 40,
): Promise<number> {
  const { data, error } = await client
    .from("artifacts")
    .select("id, workspace_id, title, content_markdown, metadata, drive_folder_id")
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  let synced = 0;
  for (const row of data ?? []) {
    const metadata = (row.metadata as Record<string, unknown>) ?? {};
    if (metadata.storagePath && metadata.storageSyncedAt) continue;
    await syncArtifactToStorage(
      client,
      {
        id: String(row.id),
        workspaceId,
        title: String(row.title),
        contentMarkdown: String(row.content_markdown ?? ""),
        metadata,
        driveFolderId: row.drive_folder_id ? String(row.drive_folder_id) : null,
      },
      userId,
    );
    synced += 1;
  }
  return synced;
}

export async function exportArtifactToDrive(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    artifact: SavedArtifact;
    folderId?: string | null;
    exportType?: "report" | "summary" | "artifact_bundle" | "other";
  },
): Promise<{ exportId: string; storagePath: string; signedUrl: string | null }> {
  const exportId = randomUUID();
  const storagePath = exportStoragePath(
    params.workspaceId,
    exportId,
    params.artifact.title,
    "md",
  );
  const body = Buffer.from(params.artifact.contentMarkdown, "utf8");

  const { error: uploadError } = await client.storage
    .from(DRIVE_BUCKETS.exports)
    .upload(storagePath, body, {
      contentType: "text/markdown",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { error: insertError } = await client.from("drive_exports").insert({
    id: exportId,
    workspace_id: params.workspaceId,
    room_id: params.artifact.roomId ?? null,
    topic_id: params.artifact.topicId ?? null,
    drive_folder_id: params.folderId ?? null,
    title: `${params.artifact.title} (export)`,
    export_type: params.exportType ?? "report",
    storage_bucket: DRIVE_BUCKETS.exports,
    storage_path: storagePath,
    mime_type: "text/markdown",
    size_bytes: body.byteLength,
    source_artifact_ids: [params.artifact.id],
    source_file_ids: params.artifact.sourceFileIds,
    created_by_user_id: params.userId,
    metadata: { sourceArtifactType: params.artifact.artifactType },
  });
  if (insertError) throw insertError;

  await recordStorageUsage({
    workspaceId: params.workspaceId,
    userId: params.userId,
    eventType: "export",
    bucket: DRIVE_BUCKETS.exports,
    objectPath: storagePath,
    sizeBytes: body.byteLength,
    deltaBytes: body.byteLength,
    entityType: "export",
    entityId: exportId,
  });

  const signedUrl = await createSignedDriveUrl(client, DRIVE_BUCKETS.exports, storagePath, 60 * 5);
  return { exportId, storagePath, signedUrl };
}

/** Ensure signed URLs never leave spaces unencoded (Next.js fetch cache-key failures). */
export function sanitizeSignedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname
      .split("/")
      .map((segment) => {
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch {
          return encodeURIComponent(segment);
        }
      })
      .join("/");
    return parsed.toString();
  } catch {
    return url.replace(/ /g, "%20");
  }
}

export async function createSignedDriveUrl(
  client: SupabaseClient,
  bucket: string,
  storagePath: string,
  expiresIn = 300,
): Promise<string | null> {
  const { data, error } = await client.storage.from(bucket).createSignedUrl(storagePath, expiresIn);
  if (error) {
    console.warn("[AdeHQ drive] signed URL failed", error);
    return null;
  }
  if (!data?.signedUrl) return null;
  return sanitizeSignedUrl(data.signedUrl);
}
