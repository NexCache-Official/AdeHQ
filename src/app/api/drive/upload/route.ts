import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { assertTopicInRoom, ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { embedFileChunks } from "@/lib/server/file-embeddings";
import { checkUploadQuota, recordStorageUsage } from "@/lib/drive/quota-server";
import { workspaceFileFromRow } from "@/lib/files/records";
import {
  fileChecksum,
  parseUploadedFile,
  sanitizeFileName,
  validateUploadType,
  WORKSPACE_FILE_BUCKET,
} from "@/lib/server/file-processing";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function displayNameFromUser(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  const meta = user.user_metadata;
  return (
    (typeof meta?.full_name === "string" && meta.full_name) ||
    (typeof meta?.name === "string" && meta.name) ||
    user.email?.split("@")[0] ||
    "You"
  );
}

async function deleteExistingDriveFile(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    fileId: string;
    folderId: string | null;
    userId: string;
    role: string;
  },
): Promise<{ ok: true; displayName: string } | { ok: false; status: number; error: string }> {
  const { data: row, error } = await client
    .from("workspace_files")
    .select("id, display_name, storage_bucket, storage_path, size_bytes, drive_folder_id, uploaded_by_user_id")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.fileId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { ok: false, status: 404, error: "File to replace was not found." };

  const existingFolder = row.drive_folder_id ? String(row.drive_folder_id) : null;
  if (existingFolder !== params.folderId) {
    return { ok: false, status: 400, error: "Replace target is not in this folder." };
  }

  const isAdmin = params.role === "admin";
  if (!isAdmin && String(row.uploaded_by_user_id ?? "") !== params.userId) {
    return {
      ok: false,
      status: 403,
      error: "Only the uploader or a workspace admin can replace this file.",
    };
  }

  const storageBucket = String(row.storage_bucket ?? WORKSPACE_FILE_BUCKET);
  const storagePath = String(row.storage_path ?? "");
  if (storagePath) {
    const { error: storageError } = await client.storage.from(storageBucket).remove([storagePath]);
    if (storageError) console.warn("[AdeHQ drive upload] replace storage remove failed", storageError);
  }

  await client
    .from("message_attachments")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("file_id", params.fileId);

  await recordStorageUsage({
    workspaceId: params.workspaceId,
    userId: params.userId,
    eventType: "delete",
    bucket: storageBucket,
    objectPath: storagePath,
    sizeBytes: Number(row.size_bytes ?? 0),
    deltaBytes: -Number(row.size_bytes ?? 0),
    entityType: "file",
    entityId: params.fileId,
  }).catch((err) => console.warn("[AdeHQ drive upload] replace quota ledger failed", err));

  const { error: deleteError } = await client
    .from("workspace_files")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.fileId);
  if (deleteError) throw deleteError;

  return { ok: true, displayName: sanitizeFileName(String(row.display_name)) };
}

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const form = await request.formData();
    const file = form.get("file");
    const workspaceId = String(form.get("workspaceId") ?? "");
    const roomId = form.get("roomId") ? String(form.get("roomId")) : null;
    let topicId = form.get("topicId") ? String(form.get("topicId")) : null;
    const folderId = form.get("folderId") ? String(form.get("folderId")) : null;
    const replaceFileId = form.get("replaceFileId") ? String(form.get("replaceFileId")) : null;
    const displayNameOverride = form.get("displayName") ? String(form.get("displayName")) : null;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload a file." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "This file is empty." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);

    const quotaCheck = await checkUploadQuota(workspaceId, file.size);
    if (!quotaCheck.ok) {
      return NextResponse.json({ error: quotaCheck.error }, { status: 413 });
    }

    if (roomId) {
      await assertCanAccessRoom(client, workspaceId, roomId, user.id, role);
      if (!topicId) {
        const general = await ensureGeneralTopic(client, workspaceId, roomId);
        topicId = general.id;
      } else {
        await assertTopicInRoom(client, workspaceId, roomId, topicId);
      }
    }

    if (folderId) {
      const { data: folder, error: folderError } = await client
        .from("drive_folders")
        .select("id, section")
        .eq("workspace_id", workspaceId)
        .eq("id", folderId)
        .maybeSingle();
      if (folderError) throw folderError;
      if (!folder) {
        return NextResponse.json({ error: "Folder not found." }, { status: 404 });
      }
      if (String(folder.section) !== "files") {
        return NextResponse.json({ error: "Upload files into a Files folder." }, { status: 400 });
      }
    }

    const validation = validateUploadType(file.name, file.type);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    let displayName = sanitizeFileName(displayNameOverride || file.name);
    if (replaceFileId) {
      const replaced = await deleteExistingDriveFile(client, {
        workspaceId,
        fileId: replaceFileId,
        folderId,
        userId: user.id,
        role,
      });
      if (!replaced.ok) {
        return NextResponse.json({ error: replaced.error }, { status: replaced.status });
      }
      // Keep the original name when replacing unless the client overrode it.
      if (!displayNameOverride) displayName = replaced.displayName;
    }

    const fileId = randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = fileChecksum(buffer);
    const storagePath = `${workspaceId}/${fileId}/${displayName}`;

    const { error: uploadError } = await client.storage
      .from(WORKSPACE_FILE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: validation.mimeType,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: inserted, error: insertError } = await client
      .from("workspace_files")
      .insert({
        id: fileId,
        workspace_id: workspaceId,
        room_id: roomId,
        topic_id: topicId,
        drive_folder_id: folderId,
        drive_section: "files",
        uploaded_by_user_id: user.id,
        original_name: file.name,
        display_name: displayName,
        mime_type: validation.mimeType,
        extension: validation.extension,
        size_bytes: file.size,
        storage_bucket: WORKSPACE_FILE_BUCKET,
        storage_path: storagePath,
        status: "processing",
        parse_status: "processing",
        checksum,
        source_metadata: { uploadedByName: displayNameFromUser(user), source: "adehq_drive" },
      })
      .select("*")
      .single();
    if (insertError) throw insertError;

    await recordStorageUsage({
      workspaceId,
      userId: user.id,
      eventType: "upload",
      bucket: WORKSPACE_FILE_BUCKET,
      objectPath: storagePath,
      sizeBytes: file.size,
      deltaBytes: file.size,
      entityType: "file",
      entityId: fileId,
    }).catch((error) => console.warn("[AdeHQ drive upload] quota ledger failed", error));

    // File is already in storage + workspace_files. Parse/chunk/embed failures
    // must not turn a successful upload into a client-visible 500 — otherwise
    // the progress bar finishes and Drive looks empty even though the row exists.
    try {
      const parsed = await parseUploadedFile(buffer, validation.extension);

      // File bytes are already in storage — never demote the row to status=failed
      // (Drive list historically hid those, so uploads looked like they vanished).
      const fileStatus = parsed.parseStatus === "failed" ? "ready" : parsed.status;
      const { data: updated, error: updateError } = await client
        .from("workspace_files")
        .update({
          status: fileStatus,
          parse_status: parsed.parseStatus,
          extracted_text: parsed.extractedText,
          text_preview: parsed.textPreview,
          page_count: parsed.pageCount ?? null,
          sheet_count: parsed.sheetCount ?? null,
          row_count: parsed.rowCount ?? null,
          source_metadata: {
            ...(inserted.source_metadata ?? {}),
            ...parsed.sourceMetadata,
          },
          error_message: parsed.errorMessage ?? null,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", fileId)
        .select("*")
        .single();
      if (updateError) throw updateError;

      if (parsed.chunks.length) {
        const { data: insertedChunks, error: chunkError } = await client
          .from("file_chunks")
          .insert(
            parsed.chunks.map((chunk) => ({
              workspace_id: workspaceId,
              file_id: fileId,
              room_id: roomId,
              topic_id: topicId,
              chunk_index: chunk.chunkIndex,
              content: chunk.content,
              content_preview: chunk.contentPreview,
              page_start: chunk.pageStart ?? null,
              page_end: chunk.pageEnd ?? null,
              sheet_name: chunk.sheetName ?? null,
              row_start: chunk.rowStart ?? null,
              row_end: chunk.rowEnd ?? null,
              token_estimate: chunk.tokenEstimate,
              metadata: chunk.metadata ?? {},
            })),
          )
          .select("id, content");
        if (chunkError) throw chunkError;

        if (parsed.parseStatus === "parsed" && insertedChunks?.length) {
          await embedFileChunks(
            client,
            workspaceId,
            fileId,
            (insertedChunks as Array<{ id: string; content: string }>).map((row) => ({
              id: String(row.id),
              content: String(row.content),
            })),
            { roomId: roomId ?? undefined, topicId: topicId ?? undefined },
          ).catch((error) => console.warn("[AdeHQ drive upload] embedding failed", error));
        }
      }

      return NextResponse.json({
        file: workspaceFileFromRow(updated as Record<string, unknown>),
        chunksCreated: parsed.chunks.length,
        ...(parsed.parseStatus === "failed"
          ? { warning: parsed.errorMessage ?? "File saved, but text extraction failed." }
          : {}),
      });
    } catch (postPersistError) {
      console.warn("[AdeHQ drive upload] post-persist processing failed", postPersistError);
      await client
        .from("workspace_files")
        .update({
          status: "ready",
          parse_status: "failed",
          error_message: "Uploaded, but text extraction failed. You can still download the file.",
        })
        .eq("workspace_id", workspaceId)
        .eq("id", fileId)
        .then(({ error }) => {
          if (error) console.warn("[AdeHQ drive upload] status fallback failed", error);
        });
      return NextResponse.json({
        file: workspaceFileFromRow(inserted as Record<string, unknown>),
        chunksCreated: 0,
        warning: "File saved, but indexing failed.",
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive upload]", error);
    return NextResponse.json({ error: "Unable to upload file." }, { status: 500 });
  }
}
