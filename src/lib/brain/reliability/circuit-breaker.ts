import type { RouteHealth } from "./types";

type Sample = { ok: boolean; timedOut: boolean; schemaFailed: boolean; latencyMs: number; at: number };

const WINDOW_MS = 15 * 60_000;
const samples = new Map<string, Sample[]>();
const disabledUntil = new Map<string, number>();

function prune(routeId: string, now: number) {
  const list = samples.get(routeId) ?? [];
  const next = list.filter((s) => now - s.at <= WINDOW_MS);
  samples.set(routeId, next);
  return next;
}

export function recordRouteSample(
  routeId: string,
  sample: Omit<Sample, "at">,
): void {
  const now = Date.now();
  const list = prune(routeId, now);
  list.push({ ...sample, at: now });
  samples.set(routeId, list);

  const health = getRouteHealth(routeId);
  if (
    list.length >= 8 &&
    (health.recentSuccessRate < 0.5 ||
      health.recentTimeoutRate > 0.4 ||
      health.schemaFailureRate > 0.35)
  ) {
    disabledUntil.set(routeId, now + 5 * 60_000);
  }
}

export function getRouteHealth(routeId: string): RouteHealth {
  const now = Date.now();
  const list = prune(routeId, now);
  const n = list.length || 1;
  const ok = list.filter((s) => s.ok).length;
  const timedOut = list.filter((s) => s.timedOut).length;
  const schemaFailed = list.filter((s) => s.schemaFailed).length;
  const latencies = [...list.map((s) => s.latencyMs)].sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? p50;
  const until = disabledUntil.get(routeId);

  return {
    routeId,
    recentSuccessRate: ok / n,
    recentTimeoutRate: timedOut / n,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    schemaFailureRate: schemaFailed / n,
    disabledUntil: until && until > now ? new Date(until).toISOString() : undefined,
  };
}

export function isRouteCircuitOpen(routeId: string): boolean {
  const until = disabledUntil.get(routeId);
  return Boolean(until && until > Date.now());
}
