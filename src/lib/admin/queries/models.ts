import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { PINNED_PROVIDER_POLICY_V2012 } from "@/lib/ai/runtime/provider-policy";

export type ModelCatalogRow = {
  endpointKey: string | null;
  providerRoute: string;
  modelId: string;
  displayName: string | null;
  modelType: string;
  inputCostPerMillion: number | null;
  outputCostPerMillion: number | null;
  enabled: boolean;
  source: string | null;
  priceFetchedAt: string | null;
};

export type ProviderHealthCard = {
  provider: string;
  configured: boolean;
  endpointCount: number;
  enabledCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  status: "healthy" | "degraded" | "disabled" | "unknown";
};

export type ModelsSummary = {
  catalog: ModelCatalogRow[];
  providerHealth: ProviderHealthCard[];
  runtimeFlags: ReturnType<typeof getRuntimeFlags>;
  pinnedPolicy: Record<string, { providerRoute: string; modelId: string }>;
  recentSyncRuns: {
    id: string;
    provider: string;
    status: string;
    offersAdded: number;
    offersUpdated: number;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
};

function isProviderConfigured(provider: string): boolean {
  switch (provider) {
    case "siliconflow":
      return Boolean(process.env.SILICONFLOW_API_KEY?.trim());
    case "vercel_gateway":
      return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
    case "tavily":
      return Boolean(process.env.TAVILY_API_KEY?.trim());
    case "browserbase":
      return Boolean(process.env.BROWSERBASE_API_KEY?.trim());
    case "mock":
      return true;
    default:
      return false;
  }
}

export async function getModelsSummary(client: SupabaseClient): Promise<ModelsSummary> {
  const [catalogRes, healthRes, syncRes] = await Promise.all([
    client
      .from("ai_model_catalog")
      .select(
        "endpoint_key, provider_route, model_id, display_name, model_type, input_cost_per_million, output_cost_per_million, enabled, source, price_fetched_at",
      )
      .order("provider_route")
      .order("model_id"),
    client
      .from("ai_model_route_health")
      .select(
        "provider_route, model_id, success_count, failure_count, fallback_count, avg_latency_ms, p95_latency_ms",
      ),
    client
      .from("ai_model_sync_runs")
      .select("id, provider, status, offers_added, offers_updated, error, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  for (const res of [catalogRes, healthRes, syncRes]) {
    if (res.error) throw res.error;
  }

  const catalog: ModelCatalogRow[] = (catalogRes.data ?? []).map((row) => ({
    endpointKey: row.endpoint_key,
    providerRoute: row.provider_route,
    modelId: row.model_id,
    displayName: row.display_name,
    modelType: row.model_type ?? "language",
    inputCostPerMillion:
      row.input_cost_per_million != null ? Number(row.input_cost_per_million) : null,
    outputCostPerMillion:
      row.output_cost_per_million != null ? Number(row.output_cost_per_million) : null,
    enabled: row.enabled,
    source: row.source,
    priceFetchedAt: row.price_fetched_at,
  }));

  // Provider health cards — catalog providers + operational providers without catalog rows.
  const providers = new Set<string>([
    ...catalog.map((row) => row.providerRoute),
    "tavily",
    "browserbase",
  ]);
  providers.delete("mock");

  const providerHealth: ProviderHealthCard[] = [...providers].sort().map((provider) => {
    const endpoints = catalog.filter((row) => row.providerRoute === provider);
    const health = (healthRes.data ?? []).filter((h) => h.provider_route === provider);
    const successCount = health.reduce((sum, h) => sum + (h.success_count ?? 0), 0);
    const failureCount = health.reduce((sum, h) => sum + (h.failure_count ?? 0), 0);
    const fallbackCount = health.reduce((sum, h) => sum + (h.fallback_count ?? 0), 0);
    const latencies = health
      .map((h) => (h.avg_latency_ms != null ? Number(h.avg_latency_ms) : null))
      .filter((v): v is number => v != null);
    const p95s = health
      .map((h) => h.p95_latency_ms)
      .filter((v): v is number => v != null);
    const configured = isProviderConfigured(provider);
    const enabledCount = endpoints.filter((row) => row.enabled).length;

    let status: ProviderHealthCard["status"] = "unknown";
    if (!configured) {
      status = "disabled";
    } else if (successCount + failureCount > 0) {
      const errorRate = failureCount / (successCount + failureCount);
      status = errorRate > 0.2 ? "degraded" : "healthy";
    } else if (configured) {
      status = "healthy";
    }

    return {
      provider,
      configured,
      endpointCount: endpoints.length,
      enabledCount,
      successCount,
      failureCount,
      fallbackCount,
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
      p95LatencyMs: p95s.length ? Math.max(...p95s) : null,
      status,
    };
  });

  const pinnedPolicy: ModelsSummary["pinnedPolicy"] = {};
  for (const [key, spec] of Object.entries(PINNED_PROVIDER_POLICY_V2012)) {
    pinnedPolicy[key] = {
      providerRoute: spec.providerRoute,
      modelId: spec.modelId,
    };
  }

  return {
    catalog,
    providerHealth,
    runtimeFlags: getRuntimeFlags(),
    pinnedPolicy,
    recentSyncRuns: (syncRes.data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      status: row.status,
      offersAdded: row.offers_added,
      offersUpdated: row.offers_updated,
      error: row.error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    })),
  };
}
