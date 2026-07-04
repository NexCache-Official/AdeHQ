import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryEntry } from "@/lib/types";
import { isActiveMemory } from "./active-filter";
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
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const entry = data ? memoryRowToEntry(data as Record<string, unknown>) : null;
  return entry && isActiveMemory(entry) ? entry : null;
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
