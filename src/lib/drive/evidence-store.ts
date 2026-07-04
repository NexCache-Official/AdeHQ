import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRIVE_BUCKETS } from "@/lib/drive/constants";
import { checkUploadQuota, recordStorageUsage } from "@/lib/drive/quota";
import { evidenceStoragePath } from "@/lib/drive/storage-sync";
import { browserEvidenceFromRow } from "@/lib/server/drive-list";
import { sanitizeFileName } from "@/lib/files/sanitize-file-name";
import type { BrowserEvidence } from "@/lib/types";

export type PersistBrowserEvidenceParams = {
  client: SupabaseClient;
  workspaceId: string;
  roomId?: string | null;
  topicId?: string | null;
  runId?: string;
  title: string;
  sourceUrl?: string;
  screenshot: Buffer;
  mimeType?: string;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Persist a screenshot buffer to browser_evidence + storage (server-side, no HTTP). */
export async function persistBrowserEvidence(
  params: PersistBrowserEvidenceParams,
): Promise<BrowserEvidence> {
  const mimeType = params.mimeType ?? "image/png";
  const sizeBytes = params.screenshot.byteLength;
  const quotaCheck = await checkUploadQuota(params.client, params.workspaceId, sizeBytes);
  if (!quotaCheck.ok) {
    throw new Error(quotaCheck.error ?? "Evidence upload exceeds quota.");
  }

  const evidenceId = randomUUID();
  const fileName = sanitizeFileName(`${params.title || "screenshot"}.png`);
  const storagePath = evidenceStoragePath(params.workspaceId, evidenceId, fileName);

  const { error: uploadError } = await params.client.storage
    .from(DRIVE_BUCKETS.evidence)
    .upload(storagePath, params.screenshot, { contentType: mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error: insertError } = await params.client
    .from("browser_evidence")
    .insert({
      id: evidenceId,
      workspace_id: params.workspaceId,
      room_id: params.roomId ?? null,
      topic_id: params.topicId ?? null,
      browser_research_run_id: params.runId ?? null,
      title: params.title,
      storage_bucket: DRIVE_BUCKETS.evidence,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      source_url: params.sourceUrl ?? null,
      captured_at: new Date().toISOString(),
      created_by_user_id: params.createdByUserId ?? null,
      metadata: {
        source: "browser_research_capture",
        ...params.metadata,
      },
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await recordStorageUsage(params.client, {
    workspaceId: params.workspaceId,
    userId: params.createdByUserId ?? undefined,
    eventType: "upload",
    bucket: DRIVE_BUCKETS.evidence,
    objectPath: storagePath,
    sizeBytes,
    deltaBytes: sizeBytes,
    entityType: "evidence",
    entityId: evidenceId,
  });

  return browserEvidenceFromRow(data as Record<string, unknown>);
}
