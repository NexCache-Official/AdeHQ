import type { SupabaseClient } from "@supabase/supabase-js";
import { invalidateCatalogCache } from "../catalog/loader";
import { resolveEndpointKey } from "./endpoint-key";
import { offerToCatalogRow } from "./normalize";
import { syncSiliconFlowModels } from "./siliconflow-sync";
import type { ModelEndpointOffer, PriceSnapshotInput, ProviderSyncResult, SyncOptions, SyncRunSummary } from "./types";
import { syncVercelModels } from "./vercel-sync";

const MISS_THRESHOLD = 2;
const missCounts = new Map<string, number>();

function offerKey(offer: ModelEndpointOffer): string {
  return resolveEndpointKey(offer);
}

async function upsertOffers(
  client: SupabaseClient,
  offers: ModelEndpointOffer[],
  fetchedAt: string,
  dryRun: boolean,
): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  for (const offer of offers) {
    const row = offerToCatalogRow({ ...offer, priceFetchedAt: fetchedAt }, fetchedAt);
    const key = offerKey(offer);
    missCounts.set(key, 0);

    if (dryRun) {
      console.log(`  [dry-run] ${key} source=${offer.source} in=${offer.inputCostPerMillion} out=${offer.outputCostPerMillion}`);
      updated += 1;
      continue;
    }

    const { data: existing } = await client
      .from("ai_model_catalog")
      .select("id")
      .eq("endpoint_key", key)
      .maybeSingle();

    const { error } = await client.from("ai_model_catalog").upsert(row, {
      onConflict: "endpoint_key",
    });

    if (error) throw new Error(`Catalog upsert failed for ${key}: ${error.message}`);
    if (existing?.id) updated += 1;
    else added += 1;
  }

  return { added, updated };
}

async function insertSnapshots(
  client: SupabaseClient,
  snapshots: PriceSnapshotInput[],
  dryRun: boolean,
): Promise<void> {
  if (dryRun || !snapshots.length) return;

  const rows = snapshots.map((s) => ({
    provider_route: s.providerRoute,
    model_id: s.modelId,
    input_cost_per_million: s.inputCostPerMillion ?? null,
    output_cost_per_million: s.outputCostPerMillion ?? null,
    cached_input_cost_per_million: s.cachedInputCostPerMillion ?? null,
    cache_write_cost_per_million: s.cacheWriteCostPerMillion ?? null,
    source: s.source,
    raw_payload: { ...(s.rawPayload ?? {}), endpoint_key: s.endpointKey, gateway_provider_slug: s.gatewayProviderSlug },
    fetched_at: new Date().toISOString(),
  }));

  const { error } = await client.from("ai_model_price_snapshots").insert(rows);
  if (error) throw new Error(`Snapshot insert failed: ${error.message}`);
}

async function recordSyncRun(
  client: SupabaseClient,
  result: ProviderSyncResult,
  dryRun: boolean,
  startedAt: string,
): Promise<void> {
  if (dryRun) return;

  const { error } = await client.from("ai_model_sync_runs").insert({
    provider: result.provider,
    status: result.status,
    offers_added: result.offersAdded,
    offers_updated: result.offersUpdated,
    offers_disabled: result.offersDisabled,
    error: result.error ?? null,
    dry_run: dryRun,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });

  if (error) console.warn("[AdeHQ model pricing sync] sync run log failed:", error.message);
}

async function disableMissingOffers(
  client: SupabaseClient,
  provider: "vercel" | "siliconflow",
  seenKeys: Set<string>,
  dryRun: boolean,
): Promise<number> {
  const providerRoute = provider === "vercel" ? "vercel_gateway" : "siliconflow_direct";
  const { data: existing, error } = await client
    .from("ai_model_catalog")
    .select("endpoint_key, provider_route, model_id, enabled, source")
    .eq("provider_route", providerRoute)
    .eq("enabled", true);

  if (error || !existing) return 0;

  let disabled = 0;
  for (const row of existing) {
    const key = String(row.endpoint_key ?? `${row.provider_route}:${row.model_id}:default`);
    if (seenKeys.has(key)) continue;
    if (row.source === "manual_seed" || row.source === "manual_override") continue;

    const misses = (missCounts.get(key) ?? 0) + 1;
    missCounts.set(key, misses);
    if (misses < MISS_THRESHOLD) continue;

    if (!dryRun) {
      await client
        .from("ai_model_catalog")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("endpoint_key", key);
    }
    disabled += 1;
  }

  return disabled;
}

async function runProviderSync(
  client: SupabaseClient | null,
  provider: "vercel" | "siliconflow",
  dryRun: boolean,
): Promise<ProviderSyncResult> {
  const startedAt = new Date().toISOString();
  const result = provider === "vercel" ? await syncVercelModels() : await syncSiliconFlowModels();

  if (result.status === "success" && client) {
    const fetchedAt = new Date().toISOString();
    const seen = new Set(result.offers.map(offerKey));
    const { added, updated } = await upsertOffers(client, result.offers, fetchedAt, dryRun);
    await insertSnapshots(client, result.snapshots, dryRun);
    const disabled = await disableMissingOffers(client, provider, seen, dryRun);
    result.offersAdded = added;
    result.offersUpdated = updated;
    result.offersDisabled = disabled;
    await recordSyncRun(client, result, dryRun, startedAt);
  } else if (client && result.status !== "skipped") {
    await recordSyncRun(client, result, dryRun, startedAt);
  }

  return result;
}

export async function syncModelPricing(
  client: SupabaseClient | null,
  options: SyncOptions = {},
): Promise<SyncRunSummary> {
  const providers = options.providers ?? ["vercel", "siliconflow"];
  const dryRun = options.dryRun ?? false;
  const results: ProviderSyncResult[] = [];

  for (const provider of providers) {
    results.push(await runProviderSync(client, provider, dryRun));
  }

  if (!dryRun && client) {
    invalidateCatalogCache();
  }

  return {
    dryRun,
    results,
    totalAdded: results.reduce((s, r) => s + r.offersAdded, 0),
    totalUpdated: results.reduce((s, r) => s + r.offersUpdated, 0),
    totalDisabled: results.reduce((s, r) => s + r.offersDisabled, 0),
  };
}

export async function getLatestSyncRuns(
  client: SupabaseClient,
  limit = 10,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await client
    .from("ai_model_sync_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[AdeHQ model catalog] sync runs fetch failed:", error.message);
    return [];
  }
  return data ?? [];
}
