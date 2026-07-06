import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_SILICONFLOW_MODEL,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";
import { VERCEL_GATEWAY_DEFAULT_MODELS } from "../adapters/vercel-models";
import { normalizeModelFamily } from "../model-aliases";
import type { ModelEndpointOffer } from "./types";

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
  return {
    providerRoute: "siliconflow_direct",
    providerName: "siliconflow",
    modelId,
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
    reliabilityScore: extras.reliabilityScore ?? 8.0,
    supportsJson: !isEmbedding,
    supportsTools: false,
    supportsEmbeddings: isEmbedding,
    supportsLongContext: runtimeModes.includes("long_context"),
    enabled: true,
    source: "manual_override",
    ...extras,
  };
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
  return {
    providerRoute: "vercel_gateway",
    providerName: "vercel",
    modelId,
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
    ...extras,
  };
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
    0.8,
    1.6,
    { qualityScore: 9.0 },
  ),
  sfOffer(
    SILICONFLOW_LONG_CONTEXT_MODEL,
    "MiniMax M2.5 (Long Context)",
    ["long_context", "research_planning", "browser_research"],
    ["long_context", "research"],
    0.4,
    0.8,
    { contextWindow: 256_000, supportsLongContext: true },
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
): ModelEndpointOffer | undefined {
  return MANUAL_MODEL_OVERRIDES.find(
    (o) => o.providerRoute === providerRoute && o.modelId === modelId,
  );
}

export function mergeWithManualOverride(offer: ModelEndpointOffer): ModelEndpointOffer {
  const manual = findManualOverride(offer.providerRoute, offer.modelId);
  if (!manual) return offer;

  return {
    ...manual,
    ...offer,
    capabilities: offer.capabilities.length ? offer.capabilities : manual.capabilities,
    runtimeModes: offer.runtimeModes.length ? offer.runtimeModes : manual.runtimeModes,
    inputCostPerMillion: offer.inputCostPerMillion ?? manual.inputCostPerMillion,
    outputCostPerMillion: offer.outputCostPerMillion ?? manual.outputCostPerMillion,
    qualityScore: offer.qualityScore ?? manual.qualityScore,
    reliabilityScore: offer.reliabilityScore ?? manual.reliabilityScore,
    source:
      offer.inputCostPerMillion != null && offer.outputCostPerMillion != null
        ? offer.source
        : "manual_override",
  };
}
