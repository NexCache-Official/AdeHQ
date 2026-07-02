import type { FileChunk, SavedArtifact, WorkspaceFile } from "@/lib/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function workspaceFileFromRow(row: DbRow): WorkspaceFile {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: row.room_id ? String(row.room_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    uploadedByUserId: row.uploaded_by_user_id ? String(row.uploaded_by_user_id) : null,
    originalName: String(row.original_name),
    displayName: String(row.display_name),
    mimeType: String(row.mime_type),
    extension: String(row.extension),
    sizeBytes: Number(row.size_bytes ?? 0),
    storageBucket: String(row.storage_bucket),
    storagePath: String(row.storage_path),
    status: row.status as WorkspaceFile["status"],
    parseStatus: row.parse_status as WorkspaceFile["parseStatus"],
    extractedText: row.extracted_text ? String(row.extracted_text) : null,
    textPreview: row.text_preview ? String(row.text_preview) : null,
    pageCount: row.page_count == null ? null : Number(row.page_count),
    sheetCount: row.sheet_count == null ? null : Number(row.sheet_count),
    rowCount: row.row_count == null ? null : Number(row.row_count),
    checksum: row.checksum ? String(row.checksum) : null,
    sourceMetadata: jsonObject(row.source_metadata),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

export function fileChunkFromRow(row: DbRow): FileChunk {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    fileId: String(row.file_id),
    roomId: row.room_id ? String(row.room_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    chunkIndex: Number(row.chunk_index ?? 0),
    content: String(row.content ?? ""),
    contentPreview: row.content_preview ? String(row.content_preview) : null,
    pageStart: row.page_start == null ? null : Number(row.page_start),
    pageEnd: row.page_end == null ? null : Number(row.page_end),
    sheetName: row.sheet_name ? String(row.sheet_name) : null,
    rowStart: row.row_start == null ? null : Number(row.row_start),
    rowEnd: row.row_end == null ? null : Number(row.row_end),
    tokenEstimate: row.token_estimate == null ? null : Number(row.token_estimate),
    metadata: jsonObject(row.metadata),
    embeddingStatus: String(row.embedding_status ?? "not_started"),
    createdAt: String(row.created_at ?? nowISO()),
  };
}

export function artifactFromRow(row: DbRow): SavedArtifact {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: row.room_id ? String(row.room_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null,
    title: String(row.title),
    artifactType: row.artifact_type as SavedArtifact["artifactType"],
    status: row.status as SavedArtifact["status"],
    contentMarkdown: String(row.content_markdown ?? ""),
    contentJson: jsonObject(row.content_json),
    createdByType: row.created_by_type as SavedArtifact["createdByType"],
    createdById: row.created_by_id ? String(row.created_by_id) : null,
    sourceFileIds: jsonArray<string>(row.source_file_ids),
    sourceMessageIds: jsonArray<string>(row.source_message_ids),
    sourceChunkIds: jsonArray<string>(row.source_chunk_ids),
    sourceCitations: jsonArray<Record<string, unknown>>(row.source_citations),
    memorySavedAt: row.memory_saved_at ? String(row.memory_saved_at) : null,
    metadata: jsonObject(row.metadata),
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}
