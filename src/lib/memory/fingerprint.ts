import type { MemoryScope } from "@/lib/types";
import { normalizeMemoryScope } from "./scope-rules";

export type { MemoryScope };

export type MemoryDedupeInput = {
  workspaceId: string;
  title: string;
  content: string;
  scope: MemoryScope;
  roomId?: string;
  topicId?: string | null;
  sourceMessageId?: string;
  sourceFileId?: string;
  sourceArtifactId?: string;
  suggestionKey?: string;
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.-]/g, "")
    .trim();
}

/** Primary body used for near-duplicate detection (strips trailing reason/source lines). */
export function memoryBodyForFingerprint(content: string): string {
  return content.split(/\n\n(?:Reason:|Source )/)[0]?.trim() ?? content.trim();
}

/** Deterministic dedupe key — same inputs always produce the same key within a workspace. */
export function buildMemoryDedupeKey(input: MemoryDedupeInput): string {
  const scope = normalizeMemoryScope(input.scope);
  const scopeRoom = scope === "workspace" ? "" : (input.roomId ?? "");
  const scopeTopic = scope === "topic" ? (input.topicId ?? "") : "";
  const scopeEmployee = scope === "employee_dm" || scope === "employee_profile" ? scopeRoom : "";

  if (input.suggestionKey?.trim()) {
    return [
      input.workspaceId,
      "suggestion",
      input.suggestionKey.trim(),
    ].join("|");
  }

  if (input.sourceMessageId?.trim()) {
    return [
      input.workspaceId,
      "msg",
      input.sourceMessageId.trim(),
      normalizeText(input.title),
      normalizeText(memoryBodyForFingerprint(input.content)),
    ].join("|");
  }

  if (input.sourceFileId?.trim() || input.sourceArtifactId?.trim()) {
    return [
      input.workspaceId,
      scope,
      scopeRoom,
      scopeTopic,
      scopeEmployee,
      input.sourceFileId?.trim() ?? "",
      input.sourceArtifactId?.trim() ?? "",
      normalizeText(input.title),
      normalizeText(memoryBodyForFingerprint(input.content)),
    ].join("|");
  }

  return [
    input.workspaceId,
    scope,
    scopeRoom,
    scopeTopic,
    scopeEmployee,
    normalizeText(input.title),
    normalizeText(memoryBodyForFingerprint(input.content)),
  ].join("|");
}

export type TopicSummarySuggestionKeyInput = {
  title?: string;
  content?: string;
  text?: string;
  sourceMessageId?: string;
};

/**
 * Content/source-based stable key for a topic-summary memory suggestion.
 * Intentionally independent of the summary refresh timestamp and list index so
 * that saved/dismissed lifecycle state (and dedupe) survive summary regeneration.
 */
export function suggestionKeyForTopicSummary(
  topicId: string,
  suggestion: TopicSummarySuggestionKeyInput,
): string {
  if (suggestion.sourceMessageId?.trim()) {
    return `topic-summary:${topicId}:msg:${suggestion.sourceMessageId.trim()}`;
  }
  const basis = normalizeText(
    `${suggestion.title ?? ""} ${suggestion.content ?? suggestion.text ?? ""}`,
  ).slice(0, 140);
  return `topic-summary:${topicId}:${basis}`;
}
