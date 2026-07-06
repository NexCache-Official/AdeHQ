import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_SILICONFLOW_MODEL,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";
import { VERCEL_GATEWAY_DEFAULT_MODELS } from "../adapters/vercel-models";
import { withEndpointKey } from "./endpoint-key";
import { normalizeModelFamily } from "../model-aliases";
import type { ModelEndpointOffer } from "./types";

const VERIFIED_AT = "2026-07-06";

function provenance(
  sourceUrl: string,
  notes: string,
  priceSource: "vercel_page_manual" | "siliconflow_page_manual" = "siliconflow_page_manual",
): ModelEndpointOffer["metadata"] {
  return {
    priceSource,
    verifiedAt: VERIFIED_AT,
    verifiedBy: "manual_page_check",
    sourceUrl,
    notes,
  };
}

function sfOffer(
  modelId: string,
  displayName: string,
  capabilities: ModelEndpointOffer["capabilities"],
  runtimeModes: string[],
  input: number,
  output: number,
  extras: Partial<ModelEndpointOffer> = {},
): ModelEndpointOffer {
  const isEmbedding = capabilities.includes("embedding");
  return withEndpointKey({
    providerRoute: "siliconflow_direct",
    providerName: "siliconflow",
    modelId,
    gatewayProviderSlug: "default",
    normalizedModelFamily: normalizeModelFamily(modelId),
    displayName,
    modelType: isEmbedding ? "embedding" : "language",
    capabilities,
    runtimeModes,
    contextWindow: extras.contextWindow ?? 128_000,
    inputCostPerMillion: input,
    outputCostPerMillion: output,
    cachedInputCostPerMillion: extras.cachedInputCostPerMillion,
    cacheReadCostPerMillion: extras.cachedInputCostPerMillion,
    currency: "USD",
    qualityScore: extras.qualityScore ?? 7.5,
    reliabilityScore: extras.reliabilityScore ?? 8.0,
    supportsJson: !isEmbedding,
    supportsTools: false,
    supportsEmbeddings: isEmbedding,
    supportsLongContext: runtimeModes.includes("long_context"),
    enabled: true,
    source: "manual_override",
    metadata: extras.metadata ?? provenance(
      "https://www.siliconflow.com/models",
      `SiliconFlow manual override for ${modelId}`,
    ),
    ...extras,
  });
}

function vgOffer(
  modelId: string,
  displayName: string,
  capabilities: ModelEndpointOffer["capabilities"],
  runtimeModes: string[],
  input: number,
  output: number,
  extras: Partial<ModelEndpointOffer> = {},
): ModelEndpointOffer {
  const isEmbedding = capabilities.includes("embedding");
  return withEndpointKey({
    providerRoute: "vercel_gateway",
    providerName: "vercel",
    modelId,
    gatewayProviderSlug: "default",
    normalizedModelFamily: normalizeModelFamily(modelId),
    displayName,
    modelType: isEmbedding ? "embedding" : "language",
    capabilities,
    runtimeModes,
    contextWindow: extras.contextWindow ?? 128_000,
    inputCostPerMillion: input,
    outputCostPerMillion: output,
    currency: "USD",
    qualityScore: extras.qualityScore ?? 7.5,
    reliabilityScore: extras.reliabilityScore ?? 8.5,
    supportsJson: !isEmbedding,
    supportsTools: !isEmbedding,
    supportsEmbeddings: isEmbedding,
    supportsLongContext: runtimeModes.includes("long_context"),
    enabled: true,
    source: "manual_override",
    metadata: extras.metadata ?? provenance(
      "https://vercel.com/ai-gateway/models",
      `Vercel gateway manual override for ${modelId}`,
      "vercel_page_manual",
    ),
    ...extras,
  });
}

/** Known-safe manual pricing when provider APIs omit rates. */
export const MANUAL_MODEL_OVERRIDES: ModelEndpointOffer[] = [
  sfOffer(
    SILICONFLOW_CHEAP_MODEL,
    "DeepSeek V3 (Efficient)",
    ["quick_reply", "classification", "memory_curation", "summarization"],
    ["efficient"],
    0.1,
    0.15,
  ),
  sfOffer(
    DEFAULT_SILICONFLOW_MODEL,
    "DeepSeek V4 Flash (Balanced)",
    ["structured_chat", "summarization", "artifact_generation", "reasoning"],
    ["balanced"],
    0.3,
    0.6,
  ),
  sfOffer(
    SILICONFLOW_STRONG_MODEL,
    "DeepSeek V4 Pro (Strong)",
    ["deep_reasoning", "artifact_generation", "research_planning"],
    ["strong", "research"],
    1.6,
    3.135,
    {
      qualityScore: 9.0,
      cachedInputCostPerMillion: 0.135,
      contextWindow: 1_049_000,
      maxOutputTokens: 393_000,
      metadata: provenance(
        "https://www.siliconflow.com/models/deepseek-v4-pro",
        "SiliconFlow DeepSeek V4 Pro official pricing",
      ),
    },
  ),
  sfOffer(
    SILICONFLOW_LONG_CONTEXT_MODEL,
    "MiniMax M2.5 (Long Context)",
    ["long_context", "research_planning", "browser_research"],
    ["long_context", "research"],
    0.3,
    1.2,
    {
      cachedInputCostPerMillion: 0.03,
      contextWindow: 197_000,
      maxOutputTokens: 131_000,
      metadata: provenance(
        "https://www.siliconflow.com/models/minimaxai",
        "SiliconFlow MiniMax M2.5 official pricing",
      ),
    },
  ),
  sfOffer(
    SILICONFLOW_CODER_MODEL,
    "Qwen3 Coder",
    ["coding", "structured_chat"],
    ["coding"],
    0.5,
    1.0,
  ),
  sfOffer(
    DEFAULT_EMBEDDING_MODEL,
    "BGE Large EN v1.5",
    ["embedding"],
    ["embedding"],
    0.02,
    0.02,
    { contextWindow: 8192 },
  ),
  vgOffer(
    VERCEL_GATEWAY_DEFAULT_MODELS.efficient,
    "GPT-4o Mini (Efficient)",
    ["quick_reply", "classification", "memory_curation", "summarization"],
    ["efficient"],
    0.15,
    0.6,
    { supportsTools: true },
  ),
  vgOffer(
    VERCEL_GATEWAY_DEFAULT_MODELS.balanced,
    "GPT-4o Mini (Balanced)",
    ["structured_chat", "summarization", "artifact_generation", "reasoning"],
    ["balanced"],
    0.15,
    0.6,
    { supportsTools: true },
  ),
  vgOffer(
    VERCEL_GATEWAY_DEFAULT_MODELS.strong,
    "Claude Sonnet 4 (Strong)",
    ["deep_reasoning", "artifact_generation", "research_planning"],
    ["strong", "research"],
    3.0,
    15.0,
    { qualityScore: 9.0, supportsTools: true },
  ),
  vgOffer(
    VERCEL_GATEWAY_DEFAULT_MODELS.long_context,
    "Gemini 2.5 Flash (Long Context)",
    ["long_context", "research_planning"],
    ["long_context", "research"],
    0.15,
    0.6,
    { contextWindow: 1_000_000, supportsLongContext: true, supportsTools: true },
  ),
  vgOffer(
    VERCEL_GATEWAY_DEFAULT_MODELS.coding,
    "GPT-4o Mini (Coding)",
    ["coding", "structured_chat"],
    ["coding"],
    0.15,
    0.6,
    { supportsTools: true },
  ),
  vgOffer(
    VERCEL_GATEWAY_DEFAULT_MODELS.embedding,
    "Text Embedding 3 Small",
    ["embedding"],
    ["embedding"],
    0.02,
    0.02,
    { contextWindow: 8192 },
  ),
];

export function findManualOverride(
  providerRoute: string,
  modelId: string,
  gatewayProviderSlug?: string | null,
): ModelEndpointOffer | undefined {
  const slug = gatewayProviderSlug ?? "default";
  return MANUAL_MODEL_OVERRIDES.find(
    (o) =>
      o.providerRoute === providerRoute &&
      o.modelId === modelId &&
      (o.gatewayProviderSlug ?? "default") === slug,
  );
}

export function mergeWithManualOverride(offer: ModelEndpointOffer): ModelEndpointOffer {
  const manual = findManualOverride(
    offer.providerRoute,
    offer.modelId,
    offer.gatewayProviderSlug,
  );
  if (!manual) return withEndpointKey(offer);

  const merged = withEndpointKey({
    ...manual,
    ...offer,
    capabilities: offer.capabilities.length ? offer.capabilities : manual.capabilities,
    runtimeModes: offer.runtimeModes.length ? offer.runtimeModes : manual.runtimeModes,
    inputCostPerMillion: offer.inputCostPerMillion ?? manual.inputCostPerMillion,
    outputCostPerMillion: offer.outputCostPerMillion ?? manual.outputCostPerMillion,
    cachedInputCostPerMillion:
      offer.cachedInputCostPerMillion ?? manual.cachedInputCostPerMillion,
    cacheReadCostPerMillion:
      offer.cacheReadCostPerMillion ?? manual.cacheReadCostPerMillion,
    contextWindow: offer.contextWindow ?? manual.contextWindow,
    maxOutputTokens: offer.maxOutputTokens ?? manual.maxOutputTokens,
    qualityScore: offer.qualityScore ?? manual.qualityScore,
    reliabilityScore: offer.reliabilityScore ?? manual.reliabilityScore,
    providerDisplayName: offer.providerDisplayName ?? manual.providerDisplayName,
    pricingDiscountActive: offer.pricingDiscountActive ?? manual.pricingDiscountActive,
    originalInputCostPerMillion:
      offer.originalInputCostPerMillion ?? manual.originalInputCostPerMillion,
    originalOutputCostPerMillion:
      offer.originalOutputCostPerMillion ?? manual.originalOutputCostPerMillion,
    pricingNotes: offer.pricingNotes ?? manual.pricingNotes,
    metadata: { ...manual.metadata, ...offer.metadata },
    source:
      offer.inputCostPerMillion != null && offer.outputCostPerMillion != null
        ? offer.source
        : "manual_override",
  });

  return merged;
}
