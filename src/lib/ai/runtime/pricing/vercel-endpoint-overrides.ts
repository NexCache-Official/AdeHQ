import type { AiCapability } from "../types";
import { withEndpointKey } from "./endpoint-key";
import { normalizeApiModel } from "./normalize";
import type { ModelEndpointOffer } from "./types";

const VERIFIED_AT = "2026-07-06";

type VercelEndpointSpec = {
  modelId: string;
  gatewayProviderSlug: string;
  providerDisplayName: string;
  displayName: string;
  capabilities: AiCapability[];
  runtimeModes: string[];
  contextWindow: number;
  maxOutputTokens?: number;
  input: number;
  output: number;
  originalInput?: number;
  originalOutput?: number;
  pricingDiscountActive?: boolean;
  pricingNotes?: string;
  qualityScore?: number;
  reliabilityScore?: number;
  supportsTools?: boolean;
  sourceUrl: string;
  notes: string;
};

const VERCEL_ENDPOINT_SPECS: VercelEndpointSpec[] = [
  {
    modelId: "deepseek/deepseek-v4-pro",
    gatewayProviderSlug: "deepseek",
    providerDisplayName: "DeepSeek",
    displayName: "DeepSeek V4 Pro (DeepSeek)",
    capabilities: ["deep_reasoning", "artifact_generation", "research_planning"],
    runtimeModes: ["strong", "research"],
    contextWindow: 1_000_000,
    maxOutputTokens: 393_000,
    input: 0.43,
    output: 0.87,
    originalInput: 1.74,
    originalOutput: 3.48,
    pricingDiscountActive: true,
    pricingNotes: "Discounted DeepSeek provider route",
    qualityScore: 9.0,
    reliabilityScore: 9.0,
    supportsTools: true,
    sourceUrl: "https://vercel.com/ai-gateway/models/deepseek-v4-pro",
    notes: "Vercel DeepSeek V4 Pro provider table",
  },
  {
    modelId: "minimax/minimax-m2.5",
    gatewayProviderSlug: "minimax",
    providerDisplayName: "MiniMax",
    displayName: "MiniMax M2.5 (MiniMax native)",
    capabilities: ["long_context", "research_planning", "browser_research"],
    runtimeModes: ["long_context", "research"],
    contextWindow: 205_000,
    maxOutputTokens: 131_000,
    input: 0.3,
    output: 1.2,
    pricingNotes: "Native MiniMax provider — 205K context",
    qualityScore: 8.0,
    reliabilityScore: 8.5,
    supportsTools: true,
    sourceUrl: "https://vercel.com/ai-gateway/models/minimax-m2.5/providers",
    notes: "Vercel MiniMax M2.5 native provider",
  },
  {
    modelId: "minimax/minimax-m2.5",
    gatewayProviderSlug: "deepinfra",
    providerDisplayName: "DeepInfra",
    displayName: "MiniMax M2.5 (DeepInfra)",
    capabilities: ["long_context", "research_planning", "browser_research"],
    runtimeModes: ["long_context", "research"],
    contextWindow: 197_000,
    maxOutputTokens: 131_000,
    input: 0.27,
    output: 0.95,
    pricingNotes: "DeepInfra provider — 197K context",
    qualityScore: 7.8,
    reliabilityScore: 8.0,
    supportsTools: true,
    sourceUrl: "https://vercel.com/ai-gateway/models/minimax-m2.5/providers",
    notes: "Vercel MiniMax via DeepInfra",
  },
  {
    modelId: "minimax/minimax-m2.5",
    gatewayProviderSlug: "blackbox",
    providerDisplayName: "Blackbox",
    displayName: "MiniMax M2.5 (Blackbox)",
    capabilities: ["long_context", "research_planning"],
    runtimeModes: ["long_context"],
    contextWindow: 128_000,
    maxOutputTokens: 65_536,
    input: 0.07,
    output: 0.57,
    pricingNotes: "Blackbox provider — 128K context cap only",
    qualityScore: 7.0,
    reliabilityScore: 7.5,
    supportsTools: false,
    sourceUrl: "https://vercel.com/ai-gateway/models/minimax-m2.5/providers",
    notes: "Cheapest but 128K context only",
  },
];

export function buildVercelEndpointOverrides(): ModelEndpointOffer[] {
  return VERCEL_ENDPOINT_SPECS.map((spec) => {
    const offer = normalizeApiModel({
      providerRoute: "vercel_gateway",
      providerName: "vercel",
      modelId: spec.modelId,
      gatewayProviderSlug: spec.gatewayProviderSlug,
      providerDisplayName: spec.providerDisplayName,
      displayName: spec.displayName,
      inputCostPerMillion: spec.input,
      outputCostPerMillion: spec.output,
      originalInputCostPerMillion: spec.originalInput,
      originalOutputCostPerMillion: spec.originalOutput,
      pricingDiscountActive: spec.pricingDiscountActive,
      pricingNotes: spec.pricingNotes,
      contextWindow: spec.contextWindow,
      maxOutputTokens: spec.maxOutputTokens,
      qualityScore: spec.qualityScore,
      reliabilityScore: spec.reliabilityScore,
      source: "manual_override",
      metadata: {
        priceSource: "vercel_page_manual",
        verifiedAt: VERIFIED_AT,
        verifiedBy: "manual_page_check",
        sourceUrl: spec.sourceUrl,
        notes: spec.notes,
      },
    });

    return withEndpointKey({
      ...offer,
      capabilities: spec.capabilities,
      runtimeModes: spec.runtimeModes,
      supportsLongContext: spec.contextWindow >= 128_000,
      supportsTools: spec.supportsTools ?? false,
      source: "manual_override",
    });
  });
}

export function findVercelEndpointOverride(
  modelId: string,
  gatewayProviderSlug: string,
): ModelEndpointOffer | undefined {
  return buildVercelEndpointOverrides().find(
    (o) => o.modelId === modelId && o.gatewayProviderSlug === gatewayProviderSlug,
  );
}

/** Model IDs that have curated per-provider endpoint rows — skip flat API rows for these. */
export function vercelModelsWithEndpointOverrides(): Set<string> {
  return new Set(VERCEL_ENDPOINT_SPECS.map((s) => s.modelId));
}
