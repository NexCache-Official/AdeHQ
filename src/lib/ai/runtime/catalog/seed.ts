import {
  DEFAULT_SILICONFLOW_MODEL,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";
import { VERCEL_GATEWAY_DEFAULT_MODELS } from "../adapters/vercel-models";
import type { AiCapability } from "../types";

/** Static trusted model catalog — source of truth until optional live sync (V19.9.0e). */
export type CatalogModelEntry = {
  id: string;
  providerRoute: "siliconflow_direct" | "vercel_gateway" | "mock";
  providerName: string;
  modelId: string;
  displayName: string;
  capabilities: AiCapability[];
  contextWindow: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  enabled: boolean;
};

const sf = (
  modelId: string,
  displayName: string,
  capabilities: AiCapability[],
  input: number,
  output: number,
  contextWindow = 128_000,
): CatalogModelEntry => ({
  id: `siliconflow:${modelId}`,
  providerRoute: "siliconflow_direct",
  providerName: "siliconflow",
  modelId,
  displayName,
  capabilities,
  contextWindow,
  inputCostPerMillion: input,
  outputCostPerMillion: output,
  enabled: true,
});

const vg = (
  modelId: string,
  displayName: string,
  capabilities: AiCapability[],
  input: number,
  output: number,
  contextWindow = 128_000,
): CatalogModelEntry => ({
  id: `vercel:${modelId}`,
  providerRoute: "vercel_gateway",
  providerName: "vercel",
  modelId,
  displayName,
  capabilities,
  contextWindow,
  inputCostPerMillion: input,
  outputCostPerMillion: output,
  enabled: true,
});

export const STATIC_MODEL_CATALOG: CatalogModelEntry[] = [
  {
    id: "mock:mock-efficient",
    providerRoute: "mock",
    providerName: "mock",
    modelId: "mock-efficient",
    displayName: "Mock Efficient",
    capabilities: ["quick_reply", "classification", "memory_curation"],
    contextWindow: 8192,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    enabled: true,
  },
  {
    id: "mock:mock-balanced",
    providerRoute: "mock",
    providerName: "mock",
    modelId: "mock-balanced",
    displayName: "Mock Balanced",
    capabilities: ["structured_chat", "summarization", "artifact_generation"],
    contextWindow: 8192,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    enabled: true,
  },
  sf(
    SILICONFLOW_CHEAP_MODEL,
    "DeepSeek V3 (Efficient)",
    ["quick_reply", "classification", "memory_curation", "summarization"],
    0.1,
    0.15,
  ),
  sf(
    DEFAULT_SILICONFLOW_MODEL,
    "DeepSeek V4 Flash (Balanced)",
    ["structured_chat", "summarization", "artifact_generation", "reasoning"],
    0.3,
    0.6,
  ),
  sf(
    SILICONFLOW_STRONG_MODEL,
    "DeepSeek V4 Pro (Strong)",
    ["deep_reasoning", "artifact_generation", "research_planning"],
    0.8,
    1.6,
  ),
  sf(
    SILICONFLOW_LONG_CONTEXT_MODEL,
    "MiniMax M2.5 (Long Context)",
    ["long_context", "research_planning", "browser_research"],
    0.4,
    0.8,
    256_000,
  ),
  sf(
    SILICONFLOW_CODER_MODEL,
    "Qwen3 Coder",
    ["coding", "structured_chat"],
    0.5,
    1.0,
  ),
  sf(
    "BAAI/bge-large-en-v1.5",
    "BGE Large EN v1.5",
    ["embedding"],
    0.02,
    0.02,
    8_192,
  ),
  vg(
    VERCEL_GATEWAY_DEFAULT_MODELS.efficient,
    "GPT-4o Mini (Efficient)",
    ["quick_reply", "classification", "memory_curation", "summarization"],
    0.15,
    0.6,
  ),
  vg(
    VERCEL_GATEWAY_DEFAULT_MODELS.balanced,
    "GPT-4o Mini (Balanced)",
    ["structured_chat", "summarization", "artifact_generation", "reasoning"],
    0.15,
    0.6,
  ),
  vg(
    VERCEL_GATEWAY_DEFAULT_MODELS.strong,
    "Claude Sonnet 4 (Strong)",
    ["deep_reasoning", "artifact_generation", "research_planning"],
    3.0,
    15.0,
  ),
  vg(
    VERCEL_GATEWAY_DEFAULT_MODELS.long_context,
    "Gemini 2.5 Flash (Long Context)",
    ["long_context", "research_planning"],
    0.15,
    0.6,
    1_000_000,
  ),
  vg(
    VERCEL_GATEWAY_DEFAULT_MODELS.coding,
    "GPT-4o Mini (Coding)",
    ["coding", "structured_chat"],
    0.15,
    0.6,
  ),
  vg(
    VERCEL_GATEWAY_DEFAULT_MODELS.embedding,
    "Text Embedding 3 Small",
    ["embedding"],
    0.02,
    0.02,
    8_192,
  ),
];

export function findCatalogModelsForCapability(
  capability: AiCapability,
  providerRoute?: CatalogModelEntry["providerRoute"],
): CatalogModelEntry[] {
  return STATIC_MODEL_CATALOG.filter(
    (m) =>
      m.enabled &&
      m.capabilities.includes(capability) &&
      (!providerRoute || m.providerRoute === providerRoute),
  );
}

export function findCatalogModelById(modelId: string): CatalogModelEntry | undefined {
  return STATIC_MODEL_CATALOG.find((m) => m.modelId === modelId);
}
