import type { SupabaseClient } from "@supabase/supabase-js";
import { METERED_PROVIDER_IDS } from "./types";

export async function ensureWorkspaceProviderAllocations(
  client: SupabaseClient,
  workspaceId: string,
  createdBy?: string | null,
): Promise<void> {
  const rows = METERED_PROVIDER_IDS.map((provider) => ({
    workspace_id: workspaceId,
    provider,
    allocation_type: "shared_pool",
    status: "active",
    created_by: createdBy ?? null,
  }));
  const { error } = await client
    .from("workspace_provider_allocations")
    .upsert(rows, { onConflict: "workspace_id,provider", ignoreDuplicates: true });
  if (error) throw error;
}
