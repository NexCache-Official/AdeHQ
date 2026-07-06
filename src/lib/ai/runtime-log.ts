import { staticCatalogOffers } from "@/lib/ai/runtime/catalog/loader";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { readPriceMaxAgeHours } from "@/lib/ai/runtime/route-optimizer";
import type { AiCapability } from "@/lib/ai/runtime/types";
import {
  DEFAULT_PROVIDER,
  DEFAULT_SILICONFLOW_MODEL,
  isSiliconFlowConfigured,
} from "@/lib/config/features";
import { isVercelGatewayConfigured } from "@/lib/ai/runtime/adapters/vercel-models";

export type AiRuntimeLogEntry = {
  id: string;
  at: string;
  workspaceId?: string;
  roomId?: string;
  employeeId?: string;
  provider: string;
  model: string;
  modelMode?: string;
  mode: "live" | "fallback" | "mock" | "blocked";
  fallbackReason?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  agentRunId?: string;
  fallbackTier?: number;
};

const MAX_ENTRIES = 40;
const entries: AiRuntimeLogEntry[] = [];
let lastEntry: AiRuntimeLogEntry | null = null;

function uid() {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recordAiRuntime(entry: Omit<AiRuntimeLogEntry, "id" | "at">) {
  const row: AiRuntimeLogEntry = {
    id: uid(),
    at: new Date().toISOString(),
    ...entry,
  };
  entries.unshift(row);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  lastEntry = row;

  console.info("[AdeHQ AI runtime]", {
    provider: row.provider,
    model: row.model,
    modelMode: row.modelMode,
    mode: row.mode,
    workspaceId: row.workspaceId,
    roomId: row.roomId,
    employeeId: row.employeeId,
    agentRunId: row.agentRunId,
    fallbackReason: row.fallbackReason,
    error: row.error,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedTokens: row.cachedTokens,
    estimatedCostUsd: row.estimatedCostUsd,
    fallbackTier: row.fallbackTier,
  });
}

function buildRoutingPreview() {
  const flags = getRuntimeFlags();
  const capabilities: AiCapability[] = [
    "structured_chat",
    "summarization",
    "embedding",
    "classification",
  ];

  return capabilities.map((capability) => {
    const route = routeCapability({ capability, catalogOffers: staticCatalogOffers() }, flags.providerPref);
    return {
      capability,
      providerRoute: route.providerRoute,
      modelId: route.modelId,
      runtimeMode: route.runtimeMode,
      estimatedWorkMinutes: route.estimatedWorkMinutes,
      estimatedCostUsd: route.estimatedCostUsd,
      fallbackCandidates: route.fallbackCandidates.map(
        (candidate) => `${candidate.providerRoute}/${candidate.modelId}`,
      ),
      routeOptimizer: route.routeOptimizer,
    };
  });
}

export function buildOptimizerPreview(params?: {
  capability?: AiCapability;
  runtimeMode?: string;
  routingPreference?: "auto" | "cost_saver" | "quality_first" | "fastest";
}) {
  const capability = params?.capability ?? "structured_chat";
  const route = routeCapability(
    {
      capability,
      runtimeMode: (params?.runtimeMode as "balanced") ?? "balanced",
      routingPreference: params?.routingPreference ?? "auto",
      catalogOffers: staticCatalogOffers(),
    },
    getRuntimeFlags().providerPref,
  );

  return {
    selected: `${route.providerRoute} / ${route.modelId}`,
    reason: route.routeOptimizer?.reason ?? "static route (optimizer off)",
    estimatedCostUsd: route.estimatedCostUsd,
    fallbacks: route.routeOptimizer?.fallbackCandidates ?? route.fallbackCandidates,
    decisionFactors: route.routeOptimizer?.decisionFactors,
    priceSource: route.routeOptimizer?.priceSource ?? "manual_seed",
    priceFreshness: route.routeOptimizer?.priceFreshness ?? "missing",
    healthNote: route.routeOptimizer?.healthNote,
    shadowOnly: route.routeOptimizer?.shadowOnly ?? false,
  };
}

export function getAiRuntimeSnapshot() {
  const flags = getRuntimeFlags();
  const catalogOffers = staticCatalogOffers();

  return {
    siliconflowConfigured: isSiliconFlowConfigured(),
    gatewayAvailable: isVercelGatewayConfigured(),
    defaultProvider: DEFAULT_PROVIDER,
    defaultSiliconflowModel: DEFAULT_SILICONFLOW_MODEL,
    environment: process.env.NODE_ENV ?? "development",
    demoModeEnabled: process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true",
    runtimeV2Mode: flags.mode,
    providerPref: flags.providerPref,
    routeOptimizerMode: flags.routeOptimizer,
    employeeDirectExecution: flags.employeeDirectExecution,
    employeeQueuedExecution: flags.employeeQueuedExecution,
    priceMaxAgeHours: readPriceMaxAgeHours(),
    routingPreview: buildRoutingPreview(),
    optimizerPreview: buildOptimizerPreview(),
    catalogSummary: {
      offerCount: catalogOffers.length,
      enabledCount: catalogOffers.filter((o) => o.enabled).length,
    },
    last: lastEntry,
    recent: entries.slice(0, 12),
  };
}
