import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEndpointKey, resolveEndpointKey } from "./pricing/endpoint-key";

export type RouteHealthSnapshot = {
  providerRoute: string;
  modelId: string;
  gatewayProviderSlug?: string;
  endpointKey: string;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  timeoutCount: number;
  jsonFailureCount: number;
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  avgCostUsd?: number;
  avgCostErrorRatio?: number;
  windowHours: number;
  computedAt?: string;
  totalSamples: number;
  successRate: number;
  fallbackRate: number;
  timeoutRate: number;
  jsonFailureRate: number;
};

export type RouteOutcomeEvent = {
  providerRoute: string;
  modelId: string;
  gatewayProviderSlug?: string;
  endpointKey?: string;
  success: boolean;
  usedFallback?: boolean;
  timedOut?: boolean;
  jsonFailure?: boolean;
  latencyMs?: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
};

const healthCache = new Map<string, RouteHealthSnapshot>();

function healthKey(
  providerRoute: string,
  modelId: string,
  gatewayProviderSlug?: string,
  endpointKey?: string,
): string {
  return endpointKey ?? buildEndpointKey(providerRoute, modelId, gatewayProviderSlug);
}

function emptyHealth(
  providerRoute: string,
  modelId: string,
  gatewayProviderSlug?: string,
  endpointKey?: string,
): RouteHealthSnapshot {
  const key = healthKey(providerRoute, modelId, gatewayProviderSlug, endpointKey);
  return {
    providerRoute,
    modelId,
    gatewayProviderSlug: gatewayProviderSlug ?? "default",
    endpointKey: key,
    successCount: 0,
    failureCount: 0,
    fallbackCount: 0,
    timeoutCount: 0,
    jsonFailureCount: 0,
    windowHours: readHealthWindowHours(),
    totalSamples: 0,
    successRate: 1,
    fallbackRate: 0,
    timeoutRate: 0,
    jsonFailureRate: 0,
  };
}

function computeRates(snapshot: RouteHealthSnapshot): RouteHealthSnapshot {
  const total =
    snapshot.successCount +
    snapshot.failureCount +
    snapshot.fallbackCount +
    snapshot.timeoutCount +
    snapshot.jsonFailureCount;
  const denom = Math.max(total, 1);
  return {
    ...snapshot,
    totalSamples: total,
    successRate: snapshot.successCount / denom,
    fallbackRate: snapshot.fallbackCount / denom,
    timeoutRate: snapshot.timeoutCount / denom,
    jsonFailureRate: snapshot.jsonFailureCount / denom,
  };
}

export function readHealthWindowHours(): number {
  const raw = Number(process.env.AI_ROUTE_HEALTH_WINDOW_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : 168;
}

export function readHealthMinSamples(): number {
  const raw = Number(process.env.AI_ROUTE_HEALTH_MIN_SAMPLES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
}

export function setRouteHealthCache(snapshot: RouteHealthSnapshot): void {
  healthCache.set(snapshot.endpointKey, computeRates(snapshot));
}

export function getRouteHealth(endpointKeyOrRoute: string, modelId?: string): RouteHealthSnapshot {
  if (modelId == null) {
    return healthCache.get(endpointKeyOrRoute) ?? emptyHealth("unknown", "unknown", "default", endpointKeyOrRoute);
  }
  const key = healthKey(endpointKeyOrRoute, modelId);
  return healthCache.get(key) ?? emptyHealth(endpointKeyOrRoute, modelId);
}

export async function loadRouteHealthFromDb(
  client: SupabaseClient,
): Promise<RouteHealthSnapshot[]> {
  const { data, error } = await client.from("ai_model_route_health").select("*");
  if (error) {
    console.warn("[AdeHQ route health] DB load failed:", error.message);
    return [];
  }

  const snapshots = (data ?? []).map((row) => {
    const endpointKey = String(
      row.endpoint_key ??
        buildEndpointKey(
          String(row.provider_route),
          String(row.model_id),
          row.gateway_provider_slug as string | undefined,
        ),
    );
    const snapshot = computeRates({
      providerRoute: String(row.provider_route),
      modelId: String(row.model_id),
      gatewayProviderSlug: String(row.gateway_provider_slug ?? "default"),
      endpointKey,
      successCount: Number(row.success_count ?? 0),
      failureCount: Number(row.failure_count ?? 0),
      fallbackCount: Number(row.fallback_count ?? 0),
      timeoutCount: Number(row.timeout_count ?? 0),
      jsonFailureCount: Number(row.json_failure_count ?? 0),
      avgLatencyMs: row.avg_latency_ms != null ? Number(row.avg_latency_ms) : undefined,
      p95LatencyMs: row.p95_latency_ms != null ? Number(row.p95_latency_ms) : undefined,
      avgCostUsd: row.avg_cost_usd != null ? Number(row.avg_cost_usd) : undefined,
      avgCostErrorRatio:
        row.avg_cost_error_ratio != null ? Number(row.avg_cost_error_ratio) : undefined,
      windowHours: Number(row.window_hours ?? readHealthWindowHours()),
      computedAt: row.computed_at ?? undefined,
      totalSamples: 0,
      successRate: 1,
      fallbackRate: 0,
      timeoutRate: 0,
      jsonFailureRate: 0,
    });
    setRouteHealthCache(snapshot);
    return snapshot;
  });

  return snapshots;
}

/** 0 = healthy, 1 = very unhealthy — applied as optimizer penalty. */
export function healthPenaltyScore(health: RouteHealthSnapshot, requiresJson = false): number {
  const minSamples = readHealthMinSamples();
  if (health.totalSamples < minSamples) return 0;

  const failureRate = health.failureCount / Math.max(health.totalSamples, 1);
  const fallbackRate = health.fallbackCount / Math.max(health.totalSamples, 1);
  const timeoutRate = health.timeoutCount / Math.max(health.totalSamples, 1);
  const jsonFailureRate = health.jsonFailureCount / Math.max(health.totalSamples, 1);

  let penalty = 0;
  penalty += failureRate * 0.35;
  penalty += fallbackRate * 0.2;
  penalty += timeoutRate * 0.25;
  if (requiresJson) penalty += jsonFailureRate * 0.4;

  if (health.successRate < 0.85) penalty += 0.15;
  if (health.successRate < 0.7) penalty += 0.2;

  return Math.min(1, Math.max(0, penalty));
}

export async function recordRouteOutcome(
  client: SupabaseClient | null,
  event: RouteOutcomeEvent,
): Promise<void> {
  const endpointKey =
    event.endpointKey ?? buildEndpointKey(event.providerRoute, event.modelId, event.gatewayProviderSlug);
  const current = getRouteHealth(endpointKey);

  const next = computeRates({
    ...current,
    gatewayProviderSlug: event.gatewayProviderSlug ?? current.gatewayProviderSlug,
    endpointKey,
    successCount: current.successCount + (event.success ? 1 : 0),
    failureCount: current.failureCount + (event.success ? 0 : 1),
    fallbackCount: current.fallbackCount + (event.usedFallback ? 1 : 0),
    timeoutCount: current.timeoutCount + (event.timedOut ? 1 : 0),
    jsonFailureCount: current.jsonFailureCount + (event.jsonFailure ? 1 : 0),
    avgLatencyMs: mergeAvg(current.avgLatencyMs, current.totalSamples, event.latencyMs),
    avgCostUsd: mergeAvg(current.avgCostUsd, current.totalSamples, event.actualCostUsd),
    avgCostErrorRatio: mergeCostError(current, event),
    computedAt: new Date().toISOString(),
  });

  setRouteHealthCache(next);

  if (!client) return;

  try {
    const { error } = await client.from("ai_model_route_health").upsert(
      {
        provider_route: event.providerRoute,
        model_id: event.modelId,
        gateway_provider_slug: event.gatewayProviderSlug ?? "default",
        endpoint_key: endpointKey,
        success_count: next.successCount,
        failure_count: next.failureCount,
        fallback_count: next.fallbackCount,
        timeout_count: next.timeoutCount,
        json_failure_count: next.jsonFailureCount,
        avg_latency_ms: next.avgLatencyMs ?? null,
        p95_latency_ms: next.p95LatencyMs ?? null,
        avg_cost_usd: next.avgCostUsd ?? null,
        avg_cost_error_ratio: next.avgCostErrorRatio ?? null,
        window_hours: next.windowHours,
        computed_at: next.computedAt,
      },
      { onConflict: "endpoint_key" },
    );

    if (error) console.warn("[AdeHQ route health] upsert failed:", error.message);
  } catch (error) {
    console.warn("[AdeHQ route health] upsert skipped:", error);
  }
}

function mergeAvg(current: number | undefined, count: number, value?: number): number | undefined {
  if (value == null || !Number.isFinite(value)) return current;
  if (current == null || count <= 0) return value;
  return (current * count + value) / (count + 1);
}

function mergeCostError(
  current: RouteHealthSnapshot,
  event: RouteOutcomeEvent,
): number | undefined {
  if (
    event.estimatedCostUsd == null ||
    event.actualCostUsd == null ||
    event.estimatedCostUsd <= 0
  ) {
    return current.avgCostErrorRatio;
  }
  const err = Math.abs(event.actualCostUsd - event.estimatedCostUsd) / event.estimatedCostUsd;
  return mergeAvg(current.avgCostErrorRatio, current.totalSamples, err);
}
