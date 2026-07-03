import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryEntry } from "@/lib/types";
import { buildMemoryDedupeKey, type MemoryDedupeInput } from "./fingerprint";
import { memoryRowToEntry } from "./build-entry";

export async function findMemoryByDedupeKey(
  client: SupabaseClient,
  workspaceId: string,
  dedupeKey: string,
): Promise<MemoryEntry | null> {
  const { data, error } = await client
    .from("memory_entries")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) throw error;
  return data ? memoryRowToEntry(data as Record<string, unknown>) : null;
}

export async function resolveMemoryInsert(
  client: SupabaseClient,
  workspaceId: string,
  dedupeInput: MemoryDedupeInput,
): Promise<{ dedupeKey: string; existing: MemoryEntry | null }> {
  const dedupeKey = buildMemoryDedupeKey(dedupeInput);
  const existing = await findMemoryByDedupeKey(client, workspaceId, dedupeKey);
  return { dedupeKey, existing };
}
