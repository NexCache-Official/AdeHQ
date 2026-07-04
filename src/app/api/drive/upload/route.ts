import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { assertTopicInRoom, ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { embedFileChunks } from "@/lib/server/file-embeddings";
import { checkUploadQuota, recordStorageUsage } from "@/lib/drive/quota";
import { workspaceFileFromRow } from "@/lib/files/records";
import {
  fileChecksum,
  parseUploadedFile,
  sanitizeFileName,
  validateUploadType,
  WORKSPACE_FILE_BUCKET,
} from "@/lib/server/file-processing";

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

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const form = await request.formData();
    const file = form.get("file");
    const workspaceId = String(form.get("workspaceId") ?? "");
    const roomId = form.get("roomId") ? String(form.get("roomId")) : null;
    let topicId = form.get("topicId") ? String(form.get("topicId")) : null;
    const folderId = form.get("folderId") ? String(form.get("folderId")) : null;

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

    const quotaCheck = await checkUploadQuota(client, workspaceId, file.size);
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

    const fileId = randomUUID();
    const displayName = sanitizeFileName(file.name);
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

    await recordStorageUsage(client, {
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

    const parsed = await parseUploadedFile(buffer, validation.extension);

    const { data: updated, error: updateError } = await client
      .from("workspace_files")
      .update({
        status: parsed.status,
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

      if (parsed.status === "ready" && insertedChunks?.length) {
        await embedFileChunks(
          client,
          workspaceId,
          fileId,
          (insertedChunks as Array<{ id: string; content: string }>).map((row) => ({
            id: String(row.id),
            content: String(row.content),
          })),
        ).catch((error) => console.warn("[AdeHQ drive upload] embedding failed", error));
      }
    }

    return NextResponse.json({
      file: workspaceFileFromRow(updated as Record<string, unknown>),
      chunksCreated: parsed.chunks.length,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive upload]", error);
    return NextResponse.json({ error: "Unable to upload file." }, { status: 500 });
  }
}
