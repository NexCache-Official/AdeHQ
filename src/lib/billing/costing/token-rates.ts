import { MANUAL_MODEL_OVERRIDES } from "@/lib/ai/runtime/pricing/manual-overrides";
import { buildVercelEndpointOverrides } from "@/lib/ai/runtime/pricing/vercel-endpoint-overrides";
import type { ModelEndpointOffer } from "@/lib/ai/runtime/pricing/types";

export type TokenRates = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
  source: "endpoint_override" | "fallback_catalog";
  providerRoute?: string;
};

/** Fallback rates when a model is missing from curated endpoint tables (USD / 1M tokens). */
const FALLBACK_RATES: Record<string, { input: number; output: number; cachedInput?: number }> = {
  "deepseek/deepseek-v4-pro": { input: 0.43, output: 0.87 },
  "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "deepseek-ai/DeepSeek-V4-Pro": { input: 1.5016, output: 3.135, cachedInput: 0.135 },
  "deepseek-ai/DeepSeek-V4-Flash": { input: 0.13, output: 0.28, cachedInput: 0.028 },
  "deepseek-ai/DeepSeek-V3": { input: 0.14, output: 0.28 },
  "Qwen/Qwen3-8B": { input: 0.06, output: 0.06 },
  "Qwen/Qwen3-Coder-30B-A3B-Instruct": { input: 0.5, output: 1.0 },
  "MiniMaxAI/MiniMax-M2.5": { input: 0.3, output: 1.2, cachedInput: 0.03 },
  "minimax/minimax-m2.5": { input: 0.3, output: 1.2 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai/text-embedding-3-small": { input: 0.02, output: 0.02 },
  "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0 },
};

const DEFAULT_RATES = { input: 0.5, output: 1.0 };

function offerList(): ModelEndpointOffer[] {
  return [...MANUAL_MODEL_OVERRIDES, ...buildVercelEndpointOverrides()];
}

function preferOffer(
  matches: ModelEndpointOffer[],
  modelId: string,
  providerRoute?: string | null,
): ModelEndpointOffer | undefined {
  if (!matches.length) return undefined;
  if (providerRoute) {
    const byRoute = matches.find((o) => o.providerRoute === providerRoute);
    if (byRoute) return byRoute;
  }
  // Gateway-style IDs (provider/model) → Vercel; SiliconFlow IDs → SF.
  if (modelId.includes("/") && !modelId.startsWith("deepseek-ai/") && !modelId.startsWith("Qwen/") && !modelId.startsWith("MiniMaxAI/") && !modelId.startsWith("BAAI/")) {
    const vg = matches.find((o) => o.providerRoute === "vercel_gateway");
    if (vg) return vg;
  }
  const sf = matches.find((o) => o.providerRoute === "siliconflow_direct");
  return sf ?? matches[0];
}

/**
 * Resolve USD-per-million token rates for a model.
 * Prefers curated endpoint overrides (Vercel Gateway / SiliconFlow) over legacy defaults.
 */
export function resolveTokenRates(
  modelId: string,
  options?: { providerRoute?: string | null },
): TokenRates {
  const id = modelId.trim();
  if (!id) {
    return {
      inputPerMillion: DEFAULT_RATES.input,
      outputPerMillion: DEFAULT_RATES.output,
      cachedInputPerMillion: DEFAULT_RATES.input,
      source: "fallback_catalog",
    };
  }

  const matches = offerList().filter(
    (o) => o.modelId === id || o.modelId.toLowerCase() === id.toLowerCase(),
  );
  const offer = preferOffer(matches, id, options?.providerRoute);
  if (offer && offer.inputCostPerMillion != null && offer.outputCostPerMillion != null) {
    const cached =
      offer.cachedInputCostPerMillion ??
      offer.cacheReadCostPerMillion ??
      offer.inputCostPerMillion;
    return {
      inputPerMillion: offer.inputCostPerMillion,
      outputPerMillion: offer.outputCostPerMillion,
      cachedInputPerMillion: cached,
      source: "endpoint_override",
      providerRoute: offer.providerRoute,
    };
  }

  const fallback = FALLBACK_RATES[id] ?? DEFAULT_RATES;
  return {
    inputPerMillion: fallback.input,
    outputPerMillion: fallback.output,
    cachedInputPerMillion: fallback.cachedInput ?? fallback.input,
    source: "fallback_catalog",
  };
}

export type EstimateTokenCostInput = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Cache-read tokens (subset of input when providers report both). */
  cachedInputTokens?: number;
  providerRoute?: string | null;
};

/**
 * USD cost from tokens × curated per-million rates.
 * Treats `cachedInputTokens` as a subset of `inputTokens` when both are present.
 */
export function estimateTokenCostUsd(input: EstimateTokenCostInput): number {
  const rates = resolveTokenRates(input.modelId, { providerRoute: input.providerRoute });
  const totalInput = Math.max(0, input.inputTokens);
  const cached = Math.min(Math.max(0, input.cachedInputTokens ?? 0), totalInput);
  const uncached = Math.max(0, totalInput - cached);
  const output = Math.max(0, input.outputTokens);

  return (
    (uncached / 1_000_000) * rates.inputPerMillion +
    (cached / 1_000_000) * rates.cachedInputPerMillion +
    (output / 1_000_000) * rates.outputPerMillion
  );
}
