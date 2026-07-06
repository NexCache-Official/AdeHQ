import type { AiCapability } from "../types";
import { normalizeModelFamily } from "../model-aliases";
import { mergeWithManualOverride } from "./manual-overrides";
import type { ModelEndpointOffer, ModelType, PriceSource } from "./types";

export function parseCapabilities(raw: unknown): AiCapability[] {
  if (!Array.isArray(raw)) return [];
  const valid: AiCapability[] = [
    "quick_reply",
    "structured_chat",
    "reasoning",
    "deep_reasoning",
    "long_context",
    "coding",
    "research_planning",
    "browser_research",
    "artifact_generation",
    "memory_curation",
    "summarization",
    "classification",
    "embedding",
    "reranking",
  ];
  return raw.filter((v): v is AiCapability => typeof v === "string" && valid.includes(v as AiCapability));
}

export function parseRuntimeModes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export function inferModelType(subtype?: string, capabilities?: AiCapability[]): ModelType {
  const lower = (subtype ?? "").toLowerCase();
  if (lower.includes("embed")) return "embedding";
  if (lower.includes("rerank")) return "reranker";
  if (capabilities?.includes("embedding")) return "embedding";
  return "language";
}

export function rowToOffer(row: Record<string, unknown>): ModelEndpointOffer {
  const capabilities = parseCapabilities(row.capabilities);
  const runtimeModes = parseRuntimeModes(row.runtime_modes);
  const modelType = (row.model_type as ModelType) ?? inferModelType(undefined, capabilities);

  return {
    id: typeof row.id === "string" ? row.id : undefined,
    providerRoute: row.provider_route as ModelEndpointOffer["providerRoute"],
    providerName: String(row.provider_name ?? ""),
    modelId: String(row.model_id ?? ""),
    normalizedModelFamily: String(row.normalized_model_family ?? normalizeModelFamily(String(row.model_id ?? ""))),
    displayName: String(row.display_name ?? row.model_id ?? ""),
    modelType,
    capabilities,
    runtimeModes,
    contextWindow: typeof row.context_window === "number" ? row.context_window : undefined,
    inputCostPerMillion: num(row.input_cost_per_million),
    outputCostPerMillion: num(row.output_cost_per_million),
    cacheReadCostPerMillion: num(row.cache_read_cost_per_million),
    cacheWriteCostPerMillion: num(row.cache_write_cost_per_million),
    currency: String(row.currency ?? "USD"),
    latencyP50Ms: int(row.latency_p50_ms),
    latencyP95Ms: int(row.latency_p95_ms),
    qualityScore: num(row.quality_score),
    reliabilityScore: num(row.reliability_score),
    supportsJson: row.supports_json !== false,
    supportsTools: row.supports_tools === true,
    supportsEmbeddings: row.supports_embeddings === true || modelType === "embedding",
    supportsLongContext: row.supports_long_context === true,
    supportsJsonVerifiedAt: strOrNull(row.supports_json_verified_at),
    supportsToolsVerifiedAt: strOrNull(row.supports_tools_verified_at),
    supportsEmbeddingsVerifiedAt: strOrNull(row.supports_embeddings_verified_at),
    enabled: row.enabled !== false,
    source: (row.source as PriceSource) ?? "manual_seed",
    priceFetchedAt: strOrNull(row.price_fetched_at),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export function offerToCatalogRow(offer: ModelEndpointOffer, fetchedAt: string): Record<string, unknown> {
  return {
    provider_route: offer.providerRoute,
    provider_name: offer.providerName,
    model_id: offer.modelId,
    display_name: offer.displayName,
    normalized_model_family: offer.normalizedModelFamily,
    model_type: offer.modelType,
    capabilities: offer.capabilities,
    runtime_modes: offer.runtimeModes,
    context_window: offer.contextWindow ?? null,
    input_cost_per_million: offer.inputCostPerMillion ?? null,
    output_cost_per_million: offer.outputCostPerMillion ?? null,
    cache_read_cost_per_million: offer.cacheReadCostPerMillion ?? null,
    cache_write_cost_per_million: offer.cacheWriteCostPerMillion ?? null,
    currency: offer.currency,
    latency_p50_ms: offer.latencyP50Ms ?? null,
    latency_p95_ms: offer.latencyP95Ms ?? null,
    quality_score: offer.qualityScore ?? null,
    reliability_score: offer.reliabilityScore ?? null,
    supports_json: offer.supportsJson,
    supports_tools: offer.supportsTools,
    supports_embeddings: offer.supportsEmbeddings,
    supports_long_context: offer.supportsLongContext,
    enabled: offer.enabled,
    source: offer.source,
    price_fetched_at: fetchedAt,
    metadata: offer.metadata ?? {},
    updated_at: fetchedAt,
  };
}

export function normalizeApiModel(params: {
  providerRoute: ModelEndpointOffer["providerRoute"];
  providerName: string;
  modelId: string;
  displayName?: string;
  modelType?: ModelType;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  contextWindow?: number;
  source: PriceSource;
  raw?: Record<string, unknown>;
}): ModelEndpointOffer {
  const base: ModelEndpointOffer = {
    providerRoute: params.providerRoute,
    providerName: params.providerName,
    modelId: params.modelId,
    normalizedModelFamily: normalizeModelFamily(params.modelId),
    displayName: params.displayName ?? params.modelId,
    modelType: params.modelType ?? "language",
    capabilities: [],
    runtimeModes: [],
    contextWindow: params.contextWindow,
    inputCostPerMillion: params.inputCostPerMillion,
    outputCostPerMillion: params.outputCostPerMillion,
    cacheReadCostPerMillion: params.cacheReadCostPerMillion,
    cacheWriteCostPerMillion: params.cacheWriteCostPerMillion,
    currency: "USD",
    supportsJson: params.modelType !== "embedding",
    supportsTools: false,
    supportsEmbeddings: params.modelType === "embedding",
    supportsLongContext: false,
    enabled: true,
    source: params.source,
    metadata: params.raw ? { api: params.raw } : {},
  };
  return mergeWithManualOverride(base);
}

function num(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function int(value: unknown): number | undefined {
  const n = num(value);
  return n != null ? Math.round(n) : undefined;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
