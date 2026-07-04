import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { checkUploadQuota, recordStorageUsage } from "@/lib/drive/quota";
import { DRIVE_BUCKETS } from "@/lib/drive/constants";
import { evidenceStoragePath } from "@/lib/drive/storage-sync";
import { browserEvidenceFromRow } from "@/lib/server/drive-list";
import { sanitizeFileName } from "@/lib/server/file-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVIDENCE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/html",
]);

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const form = await request.formData();
    const file = form.get("file");
    const workspaceId = String(form.get("workspaceId") ?? "");
    const folderId = form.get("folderId") ? String(form.get("folderId")) : null;
    const title = String(form.get("title") ?? "").trim();
    const sourceUrl = form.get("sourceUrl") ? String(form.get("sourceUrl")) : null;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a screenshot or evidence file." }, { status: 400 });
    }
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Unsupported evidence file type." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    const quotaCheck = await checkUploadQuota(client, workspaceId, file.size);
    if (!quotaCheck.ok) {
      return NextResponse.json({ error: quotaCheck.error }, { status: 413 });
    }

    if (folderId) {
      const { data: folder, error: folderError } = await client
        .from("drive_folders")
        .select("id, section")
        .eq("workspace_id", workspaceId)
        .eq("id", folderId)
        .maybeSingle();
      if (folderError) throw folderError;
      if (!folder || String(folder.section) !== "evidence") {
        return NextResponse.json({ error: "Evidence folder not found." }, { status: 404 });
      }
    }

    const evidenceId = randomUUID();
    const displayName = sanitizeFileName(file.name);
    const storagePath = evidenceStoragePath(workspaceId, evidenceId, displayName);
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await client.storage
      .from(DRIVE_BUCKETS.evidence)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error: insertError } = await client
      .from("browser_evidence")
      .insert({
        id: evidenceId,
        workspace_id: workspaceId,
        drive_folder_id: folderId,
        title: title || displayName,
        storage_bucket: DRIVE_BUCKETS.evidence,
        storage_path: storagePath,
        mime_type: file.type,
        size_bytes: file.size,
        source_url: sourceUrl,
        captured_at: new Date().toISOString(),
        created_by_user_id: user.id,
        metadata: { source: "adehq_drive_upload" },
      })
      .select("*")
      .single();
    if (insertError) throw insertError;

    await recordStorageUsage(client, {
      workspaceId,
      userId: user.id,
      eventType: "upload",
      bucket: DRIVE_BUCKETS.evidence,
      objectPath: storagePath,
      sizeBytes: file.size,
      deltaBytes: file.size,
      entityType: "evidence",
      entityId: evidenceId,
    });

    return NextResponse.json({ evidence: browserEvidenceFromRow(data as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive evidence upload]", error);
    return NextResponse.json({ error: "Unable to upload evidence." }, { status: 500 });
  }
}
