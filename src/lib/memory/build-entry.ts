import {
  categoryToLegacyType,
  inferMemoryCategory,
  inferMemoryTags,
  normalizeCategory,
  type MemoryCategory,
  type MemorySourceType,
} from "./categories";
import { normalizeMemoryScope } from "./scope-rules";
import type { MemoryEntry, MemoryScope } from "@/lib/types";
import type { TopicSummaryMemorySuggestion } from "@/lib/topic-summary/types";

export type MemoryBuildInput = {
  workspaceId: string;
  roomId: string;
  topicId?: string | null;
  topicTitle?: string;
  userId: string;
  scopeOverride?: MemoryScope;
  dmEmployeeId?: string;
  suggestion?: TopicSummaryMemorySuggestion;
  suggestionIndex?: number;
  /** Full topic summary save */
  isTopicSummary?: boolean;
  summaryText?: string;
  /** Free-text file/artifact suggestion */
  freeText?: string;
  reason?: string;
  sourceFileId?: string;
  sourceArtifactId?: string;
  sourceMessageId?: string;
  dedupeKey: string;
};

function stripMentionPrefix(text: string): string {
  return text.replace(/^@[\w\s.'-]+[—–-]\s*/i, "").trim();
}

function firstSentence(text: string, max = 220): string {
  const cleaned = stripMentionPrefix(text).replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = (match?.[1] ?? cleaned).trim();
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trim()}…`;
}

export function cleanMemoryTitle(raw: string, category?: MemoryCategory): string {
  let title = stripMentionPrefix(raw);
  title = title.replace(/^["'`]|["'`]$/g, "").trim();
  if (title.length <= 72 && !title.includes("\n")) return title;

  const sentence = firstSentence(title, 72);
  if (sentence.length <= 72) return sentence;

  if (category && category !== "Other") {
    return category === "Topic Summary" ? "Topic workstream summary" : `${category} note`;
  }
  return `${title.slice(0, 69).trim()}…`;
}

export function compactMemoryContent(title: string, content: string): string {
  const body = content.trim();
  const normalizedTitle = title.trim().toLowerCase();
  if (!body) return "";
  if (body.toLowerCase() === normalizedTitle) return "";
  if (body.toLowerCase().startsWith(normalizedTitle)) {
    const rest = body.slice(title.length).replace(/^[\s:—–-]+/, "").trim();
    return rest || body;
  }
  return body.split(/\n\nReason:/)[0]?.trim() ?? body;
}

export function memoryPreviewText(entry: Pick<MemoryEntry, "title" | "content">, maxLines = 3): string {
  const body = compactMemoryContent(entry.title, entry.content);
  if (!body) return "";
  const lines = body.split("\n").filter(Boolean).slice(0, maxLines);
  const joined = lines.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length <= 220) return joined;
  return `${joined.slice(0, 217).trim()}…`;
}

export function resolveSuggestionFields(suggestion: TopicSummaryMemorySuggestion): {
  title: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
} {
  const rawText = suggestion.content ?? suggestion.text;
  const category = normalizeCategory(suggestion.category ?? inferMemoryCategory(rawText, suggestion.reason));
  const title = cleanMemoryTitle(suggestion.title ?? rawText, category);
  const content = suggestion.content
    ? compactMemoryContent(title, suggestion.content)
    : firstSentence(stripMentionPrefix(suggestion.text), 280);
  const tags =
    suggestion.tags?.length ? suggestion.tags.slice(0, 8) : inferMemoryTags(`${title} ${content}`, category);
  return { title, content, category, tags };
}

export function buildMemoryEntryFields(input: MemoryBuildInput): {
  title: string;
  content: string;
  type: MemoryEntry["type"];
  category: MemoryCategory;
  scope: MemoryScope;
  tags: string[];
  sourceType: MemorySourceType;
  sourceMessageId?: string;
  sourceEmployeeId?: string;
  suggestedByType?: "human" | "ai" | "system";
  suggestedById?: string;
  savedByUserId: string;
  metadata: Record<string, unknown>;
} {
  const scope: MemoryScope = input.scopeOverride
    ? normalizeMemoryScope(input.scopeOverride)
    : normalizeMemoryScope(input.suggestion?.scope ?? (input.topicId ? "topic" : "room"));

  if (input.isTopicSummary && input.summaryText) {
    const category: MemoryCategory = "Topic Summary";
    const title = input.topicTitle ? `${input.topicTitle} — workstream summary` : "Topic workstream summary";
    return {
      title,
      content: input.summaryText.trim(),
      type: categoryToLegacyType(category),
      category,
      scope: "topic",
      tags: inferMemoryTags(input.summaryText, category),
      sourceType: "topic_summary",
      sourceMessageId: undefined,
      savedByUserId: input.userId,
      metadata: {
        sourceTopicId: input.topicId,
        sourceRoomId: input.roomId,
      },
    };
  }

  if (input.suggestion) {
    const fields = resolveSuggestionFields(input.suggestion);
    const senderId = input.suggestion.sourceMessageId
      ? input.suggestion.suggestedByEmployeeId
      : input.suggestion.suggestedByEmployeeId;
    return {
      title: fields.title,
      content: fields.content,
      type: categoryToLegacyType(fields.category),
      category: fields.category,
      scope,
      tags: fields.tags,
      sourceType: "ai_suggestion",
      sourceMessageId: input.suggestion.sourceMessageId,
      sourceEmployeeId: senderId,
      suggestedByType: senderId ? "ai" : undefined,
      suggestedById: senderId,
      savedByUserId: input.userId,
      metadata: {
        whyItMatters: input.suggestion.reason,
        sourceTopicId: input.topicId,
        sourceRoomId: input.roomId,
        suggestionIndex: input.suggestionIndex,
        dmEmployeeId: input.dmEmployeeId,
        scope,
      },
    };
  }

  const text = input.freeText?.trim() ?? "";
  const category = inferMemoryCategory(text, input.reason);
  const title = cleanMemoryTitle(text, category);
  const content = compactMemoryContent(title, text);
  return {
    title,
    content: content || text,
    type: categoryToLegacyType(category),
    category,
    scope,
    tags: inferMemoryTags(text, category),
    sourceType: input.sourceFileId ? "file" : input.sourceArtifactId ? "artifact" : "manual",
    sourceMessageId: input.sourceMessageId,
    savedByUserId: input.userId,
    metadata: {
      reason: input.reason,
      sourceFileId: input.sourceFileId,
      sourceArtifactId: input.sourceArtifactId,
      sourceTopicId: input.topicId,
      sourceRoomId: input.roomId,
    },
  };
}

export function memoryRowToEntry(row: Record<string, unknown>): MemoryEntry {
  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const tags = Array.isArray(row.tags) ? (row.tags as string[]) : [];
  const category = normalizeCategory(
    (row.category as string | undefined) ?? (metadata.category as string | undefined),
  );

  return {
    id: String(row.id),
    roomId: String(row.room_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    type: (row.type as MemoryEntry["type"]) ?? categoryToLegacyType(category),
    title: String(row.title),
    content: String(row.content),
    status: row.status as MemoryEntry["status"],
    createdByType: row.created_by_type as MemoryEntry["createdByType"],
    createdById: String(row.created_by_id),
    createdByRunId: row.created_by_run_id ? String(row.created_by_run_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : undefined,
    category,
    scope: (row.scope as MemoryScope | undefined) ?? (metadata.scope as MemoryScope | undefined),
    tags,
    sourceType: (row.source_type as MemorySourceType | undefined) ?? (metadata.sourceType as MemorySourceType | undefined),
    sourceMessageId:
      (row.source_message_id as string | undefined) ?? (metadata.sourceMessageId as string | undefined),
    sourceEmployeeId:
      (row.source_employee_id as string | undefined) ?? (metadata.sourceEmployeeId as string | undefined),
    suggestedByType:
      (row.suggested_by_type as MemoryEntry["suggestedByType"]) ??
      (metadata.suggestedByType as MemoryEntry["suggestedByType"]),
    suggestedById:
      (row.suggested_by_id as string | undefined) ?? (metadata.suggestedById as string | undefined),
    savedByUserId:
      (row.saved_by_user_id as string | undefined) ?? (metadata.savedByUserId as string | undefined),
    confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    metadata,
  };
}

export function memoryEntryToRow(
  workspaceId: string,
  memoryId: string,
  fields: ReturnType<typeof buildMemoryEntryFields>,
  ids: { roomId: string; topicId?: string | null; dedupeKey: string; createdAt: string },
): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    id: memoryId,
    room_id: ids.roomId,
    topic_id: fields.scope === "topic" ? ids.topicId : null,
    type: fields.type,
    title: fields.title,
    content: fields.content,
    status: "approved",
    created_by_type: "human",
    created_by_id: fields.savedByUserId,
    created_at: ids.createdAt,
    dedupe_key: ids.dedupeKey,
    category: fields.category,
    scope: fields.scope,
    tags: fields.tags,
    source_type: fields.sourceType,
    source_message_id: fields.sourceMessageId ?? null,
    source_employee_id: fields.sourceEmployeeId ?? null,
    suggested_by_type: fields.suggestedByType ?? null,
    suggested_by_id: fields.suggestedById ?? null,
    saved_by_user_id: fields.savedByUserId,
    metadata: {
      ...fields.metadata,
      sourceType: fields.sourceType,
      sourceMessageId: fields.sourceMessageId,
      sourceEmployeeId: fields.sourceEmployeeId,
      suggestedByType: fields.suggestedByType,
      suggestedById: fields.suggestedById,
      savedByUserId: fields.savedByUserId,
      scope: fields.scope,
    },
  };
}
