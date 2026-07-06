import type { ModelEndpointOffer } from "./types";
import { withEndpointKey } from "./endpoint-key";
import { normalizeModelFamily } from "../model-aliases";

export type SkuPriceParts = {
  modelId: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cachedInputCostPerMillion?: number;
};

const SKU_SUFFIXES = {
  input: [".input-tokens", ".input_tokens", "-input-tokens"],
  output: [".output-tokens", ".output_tokens", "-output-tokens"],
  cached: [".cached-input-tokens", ".cached_input_tokens", "-cached-input-tokens"],
} as const;

/** Map SiliconFlow billing SKU id → canonical model id */
const SKU_MODEL_ALIASES: Record<string, string> = {
  "minimaxai/minimax-m2.5": "MiniMaxAI/MiniMax-M2.5",
  "minimaxai/minimax-m2.5.online": "MiniMaxAI/MiniMax-M2.5",
  "deepseek-ai/deepseek-v4-pro": "deepseek-ai/DeepSeek-V4-Pro",
  "deepseek-ai/deepseek-v4-pro.online": "deepseek-ai/DeepSeek-V4-Pro",
};

function classifySku(skuId: string): "input" | "output" | "cached" | null {
  const lower = skuId.toLowerCase();
  if (SKU_SUFFIXES.cached.some((s) => lower.endsWith(s))) return "cached";
  if (SKU_SUFFIXES.output.some((s) => lower.endsWith(s))) return "output";
  if (SKU_SUFFIXES.input.some((s) => lower.endsWith(s))) return "input";
  return null;
}

function canonicalModelIdFromSku(skuId: string): string | null {
  const lower = skuId.toLowerCase();
  for (const [prefix, canonical] of Object.entries(SKU_MODEL_ALIASES)) {
    if (lower.startsWith(prefix)) return canonical;
  }
  // Strip billing suffixes and try direct match
  const stripped = lower
    .replace(/\.(online\.)?(cached-)?input-tokens$/, "")
    .replace(/\.(online\.)?output-tokens$/, "")
    .replace(/\.online$/, "");
  for (const canonical of Object.values(SKU_MODEL_ALIASES)) {
    if (canonical.toLowerCase() === stripped) return canonical;
  }
  return null;
}

function isBillingSku(rowId: string): boolean {
  return classifySku(rowId) != null;
}

export function aggregateSiliconFlowSkuRows(
  rows: Array<{ id?: string; pricing?: { input?: number | string; output?: number | string } }>,
): Map<string, SkuPriceParts> {
  const aggregated = new Map<string, SkuPriceParts>();

  for (const row of rows) {
    const skuId = row.id?.trim();
    if (!skuId || !isBillingSku(skuId)) continue;

    const kind = classifySku(skuId);
    const modelId = canonicalModelIdFromSku(skuId);
    if (!kind || !modelId) continue;

    const price = parsePrice(row.pricing?.input ?? row.pricing?.output);
    if (price == null) continue;

    const entry = aggregated.get(modelId) ?? { modelId };
    if (kind === "input") entry.inputCostPerMillion = price;
    else if (kind === "output") entry.outputCostPerMillion = price;
    else if (kind === "cached") entry.cachedInputCostPerMillion = price;
    aggregated.set(modelId, entry);
  }

  return aggregated;
}

export function applySkuPricesToOffer(
  offer: ModelEndpointOffer,
  skuParts: SkuPriceParts,
): ModelEndpointOffer {
  return withEndpointKey({
    ...offer,
    inputCostPerMillion: skuParts.inputCostPerMillion ?? offer.inputCostPerMillion,
    outputCostPerMillion: skuParts.outputCostPerMillion ?? offer.outputCostPerMillion,
    cachedInputCostPerMillion: skuParts.cachedInputCostPerMillion ?? offer.cachedInputCostPerMillion,
    cacheReadCostPerMillion: skuParts.cachedInputCostPerMillion ?? offer.cacheReadCostPerMillion,
    source:
      skuParts.inputCostPerMillion != null && skuParts.outputCostPerMillion != null
        ? "siliconflow_api"
        : offer.source,
  });
}

export function shouldSkipSiliconFlowRow(rowId: string): boolean {
  return isBillingSku(rowId);
}

function parsePrice(value: number | string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
