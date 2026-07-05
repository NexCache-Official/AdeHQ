import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryEntry } from "@/lib/types";
import { isActiveMemory } from "./active-filter";
import { memoryRowToEntry } from "./build-entry";
import {
  memoryBodyForFingerprint,
  type TopicSummarySuggestionKeyInput,
} from "./fingerprint";
import { resolveMemoryInsert } from "./dedupe";
import { normalizeMemoryScope, scopeUsesTopicId } from "./scope-rules";
import type { MemoryScope } from "@/lib/types";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.-]/g, "")
    .trim();
}

function titleMatches(a: string, b: string): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function contentMatches(a: string, b: string): boolean {
  const left = normalizeText(memoryBodyForFingerprint(a));
  const right = normalizeText(memoryBodyForFingerprint(b));
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/** Find an active saved memory matching a topic-summary suggestion, including legacy rows without dedupe_key. */
export async function findExistingMemoryForSuggestion(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    title: string;
    content: string;
    scope?: MemoryScope;
    sourceMessageId?: string;
    suggestionKey?: string;
  },
): Promise<MemoryEntry | null> {
  const scopesToTry = new Set<MemoryScope>();
  const normalized = normalizeMemoryScope(params.scope);
  scopesToTry.add(normalized);
  scopesToTry.add("employee_dm");
  scopesToTry.add("topic");
  scopesToTry.add("room");
  scopesToTry.add("workspace");

  for (const scope of scopesToTry) {
    const topicScoped = scopeUsesTopicId(scope);
    const { existing } = await resolveMemoryInsert(client, params.workspaceId, {
      workspaceId: params.workspaceId,
      title: params.title,
      content: params.content,
      scope,
      roomId: params.roomId,
      topicId: topicScoped ? params.topicId : null,
      sourceMessageId: params.sourceMessageId,
      suggestionKey: params.suggestionKey,
    });
    if (existing && isActiveMemory(existing)) return existing;
  }

  const { data, error } = await client
    .from("memory_entries")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("room_id", params.roomId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;

  for (const row of data ?? []) {
    const entry = memoryRowToEntry(row as Record<string, unknown>);
    if (!isActiveMemory(entry)) continue;
    if (titleMatches(entry.title, params.title)) return entry;
    if (contentMatches(entry.content, params.content)) return entry;
  }

  return null;
}
