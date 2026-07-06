import type { ParsedProviderUsage } from "@/lib/billing/costing/types";

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function firstPositive(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = num(source[key]);
    if (value > 0) return value;
  }
  return 0;
}

/**
 * Normalize token usage from AI SDK results and OpenAI-compatible provider payloads
 * (SiliconFlow, Vercel Gateway). Handles both camelCase (AI SDK) and snake_case (raw API)
 * shapes, plus common cached-token field names.
 *
 * When no usable token counts are present, returns zeros with costSource 'estimated'
 * so callers know to fall back to local estimation.
 */
export function parseProviderUsage(raw: unknown): ParsedProviderUsage {
  const empty: ParsedProviderUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costSource: "estimated",
  };
  if (!raw || typeof raw !== "object") return empty;

  const root = raw as Record<string, unknown>;
  // AI SDK nests token counts under `usage`; raw API returns them at the top level.
  const usage =
    root.usage && typeof root.usage === "object"
      ? (root.usage as Record<string, unknown>)
      : root;

  const inputTokens = firstPositive(usage, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = firstPositive(usage, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
  ]);
  const cachedInputTokens = firstPositive(usage, [
    "cachedInputTokens",
    "cached_input_tokens",
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "promptCacheHitTokens",
    "prompt_cache_hit_tokens",
  ]);
  const totalFromField = firstPositive(usage, ["totalTokens", "total_tokens"]);
  const totalTokens = totalFromField > 0 ? totalFromField : inputTokens + outputTokens;

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return empty;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    costSource: "provider_usage",
  };
}
