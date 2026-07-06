import type { AiCapability } from "../types";
import { normalizeModelFamily } from "../model-aliases";
import { buildEndpointKey, DEFAULT_GATEWAY_PROVIDER_SLUG, withEndpointKey } from "./endpoint-key";
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
  const gatewayProviderSlug = String(row.gateway_provider_slug ?? DEFAULT_GATEWAY_PROVIDER_SLUG);
  const providerRoute = row.provider_route as ModelEndpointOffer["providerRoute"];
  const modelId = String(row.model_id ?? "");

  const cached =
    num(row.cached_input_cost_per_million) ?? num(row.cache_read_cost_per_million);

  const offer: ModelEndpointOffer = {
    id: typeof row.id === "string" ? row.id : undefined,
    providerRoute,
    providerName: String(row.provider_name ?? ""),
    modelId,
    gatewayProviderSlug,
    endpointKey: String(row.endpoint_key ?? buildEndpointKey(providerRoute, modelId, gatewayProviderSlug)),
    providerDisplayName: strOrUndefined(row.provider_display_name),
    normalizedModelFamily: String(row.normalized_model_family ?? normalizeModelFamily(modelId)),
    displayName: String(row.display_name ?? modelId),
    modelType,
    capabilities,
    runtimeModes,
    contextWindow: typeof row.context_window === "number" ? row.context_window : undefined,
    maxOutputTokens: int(row.max_output_tokens),
    inputCostPerMillion: num(row.input_cost_per_million),
    outputCostPerMillion: num(row.output_cost_per_million),
    cacheReadCostPerMillion: cached,
    cacheWriteCostPerMillion: num(row.cache_write_cost_per_million),
    cachedInputCostPerMillion: cached,
    pricingUnit: String(row.pricing_unit ?? "per_million_tokens"),
    throughputTps: num(row.throughput_tps),
    latencySeconds: num(row.latency_seconds),
    pricingDiscountActive: row.pricing_discount_active === true,
    originalInputCostPerMillion: num(row.original_input_cost_per_million),
    originalOutputCostPerMillion: num(row.original_output_cost_per_million),
    pricingNotes: strOrUndefined(row.pricing_notes),
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

  return withEndpointKey(offer);
}

export function offerToCatalogRow(offer: ModelEndpointOffer, fetchedAt: string): Record<string, unknown> {
  const normalized = withEndpointKey(offer);
  const cached = normalized.cachedInputCostPerMillion ?? normalized.cacheReadCostPerMillion;

  return {
    endpoint_key: normalized.endpointKey,
    provider_route: normalized.providerRoute,
    provider_name: normalized.providerName,
    model_id: normalized.modelId,
    gateway_provider_slug: normalized.gatewayProviderSlug ?? DEFAULT_GATEWAY_PROVIDER_SLUG,
    provider_display_name: normalized.providerDisplayName ?? null,
    display_name: normalized.displayName,
    normalized_model_family: normalized.normalizedModelFamily,
    model_type: normalized.modelType,
    capabilities: normalized.capabilities,
    runtime_modes: normalized.runtimeModes,
    context_window: normalized.contextWindow ?? null,
    max_output_tokens: normalized.maxOutputTokens ?? null,
    input_cost_per_million: normalized.inputCostPerMillion ?? null,
    output_cost_per_million: normalized.outputCostPerMillion ?? null,
    cache_read_cost_per_million: cached ?? null,
    cache_write_cost_per_million: normalized.cacheWriteCostPerMillion ?? null,
    cached_input_cost_per_million: cached ?? null,
    pricing_unit: normalized.pricingUnit ?? "per_million_tokens",
    throughput_tps: normalized.throughputTps ?? null,
    latency_seconds: normalized.latencySeconds ?? null,
    pricing_discount_active: normalized.pricingDiscountActive ?? false,
    original_input_cost_per_million: normalized.originalInputCostPerMillion ?? null,
    original_output_cost_per_million: normalized.originalOutputCostPerMillion ?? null,
    pricing_notes: normalized.pricingNotes ?? null,
    currency: normalized.currency,
    latency_p50_ms: normalized.latencyP50Ms ?? null,
    latency_p95_ms: normalized.latencyP95Ms ?? null,
    quality_score: normalized.qualityScore ?? null,
    reliability_score: normalized.reliabilityScore ?? null,
    supports_json: normalized.supportsJson,
    supports_tools: normalized.supportsTools,
    supports_embeddings: normalized.supportsEmbeddings,
    supports_long_context: normalized.supportsLongContext,
    enabled: normalized.enabled,
    source: normalized.source,
    price_fetched_at: fetchedAt,
    metadata: normalized.metadata ?? {},
    updated_at: fetchedAt,
  };
}

export function normalizeApiModel(params: {
  providerRoute: ModelEndpointOffer["providerRoute"];
  providerName: string;
  modelId: string;
  gatewayProviderSlug?: string;
  providerDisplayName?: string;
  displayName?: string;
  modelType?: ModelType;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  cachedInputCostPerMillion?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  throughputTps?: number;
  latencySeconds?: number;
  pricingDiscountActive?: boolean;
  originalInputCostPerMillion?: number;
  originalOutputCostPerMillion?: number;
  pricingNotes?: string;
  qualityScore?: number;
  reliabilityScore?: number;
  source: PriceSource;
  raw?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): ModelEndpointOffer {
  const cached = params.cachedInputCostPerMillion ?? params.cacheReadCostPerMillion;
  const base = withEndpointKey({
    providerRoute: params.providerRoute,
    providerName: params.providerName,
    modelId: params.modelId,
    gatewayProviderSlug: params.gatewayProviderSlug,
    providerDisplayName: params.providerDisplayName,
    normalizedModelFamily: normalizeModelFamily(params.modelId),
    displayName: params.displayName ?? params.modelId,
    modelType: params.modelType ?? "language",
    capabilities: [],
    runtimeModes: [],
    contextWindow: params.contextWindow,
    maxOutputTokens: params.maxOutputTokens,
    inputCostPerMillion: params.inputCostPerMillion,
    outputCostPerMillion: params.outputCostPerMillion,
    cacheReadCostPerMillion: cached,
    cacheWriteCostPerMillion: params.cacheWriteCostPerMillion,
    cachedInputCostPerMillion: cached,
    throughputTps: params.throughputTps,
    latencySeconds: params.latencySeconds,
    pricingDiscountActive: params.pricingDiscountActive,
    originalInputCostPerMillion: params.originalInputCostPerMillion,
    originalOutputCostPerMillion: params.originalOutputCostPerMillion,
    pricingNotes: params.pricingNotes,
    qualityScore: params.qualityScore,
    reliabilityScore: params.reliabilityScore,
    currency: "USD",
    supportsJson: params.modelType !== "embedding",
    supportsTools: false,
    supportsEmbeddings: params.modelType === "embedding",
    supportsLongContext: false,
    enabled: true,
    source: params.source,
    metadata: params.metadata ?? (params.raw ? { api: params.raw } : {}),
  });
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

function strOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
