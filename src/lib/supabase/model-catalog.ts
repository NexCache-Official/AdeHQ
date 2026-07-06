import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToOffer } from "@/lib/ai/runtime/pricing/normalize";
import type { ModelEndpointOffer } from "@/lib/ai/runtime/pricing/types";
import { getLatestSyncRuns } from "@/lib/ai/runtime/pricing/sync";

export async function listCatalogOffersFromDb(
  client: SupabaseClient,
  opts?: { enabledOnly?: boolean },
): Promise<ModelEndpointOffer[]> {
  let query = client.from("ai_model_catalog").select("*").order("provider_route").order("model_id");

  if (opts?.enabledOnly !== false) {
    query = query.eq("enabled", true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load ai_model_catalog: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToOffer(row as Record<string, unknown>));
}

export async function getCatalogOffer(
  client: SupabaseClient,
  providerRoute: string,
  modelId: string,
): Promise<ModelEndpointOffer | null> {
  const { data, error } = await client
    .from("ai_model_catalog")
    .select("*")
    .eq("provider_route", providerRoute)
    .eq("model_id", modelId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToOffer(data as Record<string, unknown>);
}

export async function listCatalogOffersForAdmin(client: SupabaseClient): Promise<{
  offers: ModelEndpointOffer[];
  syncRuns: Array<Record<string, unknown>>;
}> {
  const [offers, syncRuns] = await Promise.all([
    listCatalogOffersFromDb(client, { enabledOnly: false }),
    getLatestSyncRuns(client, 20),
  ]);
  return { offers, syncRuns };
}

export { getLatestSyncRuns };
