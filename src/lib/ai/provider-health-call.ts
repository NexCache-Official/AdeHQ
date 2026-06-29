import { generateText, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { estimateCost } from "./model-catalog";
import { formatProviderError } from "./provider-errors";
import { siliconFlowProviderOptions } from "./siliconflow-client";

export type ProviderHealthResult = {
  model: string;
  reply: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
};

/**
 * Lightweight provider probe — text-only, no structured output.
 * Used by POST /api/ai/test-provider before debugging the full employee runtime.
 */
export async function callProviderHealthCheck(
  provider: string,
  models: string[],
  system: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number,
  createModel: (modelId: string) => LanguageModel,
): Promise<ProviderHealthResult> {
  let lastError: Error | null = null;
  const started = Date.now();

  for (const modelId of models) {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const result = await generateText({
        model: createModel(modelId),
        system,
        prompt,
        maxOutputTokens: maxTokens,
        temperature: 0.3,
        abortSignal: abortController.signal,
        providerOptions:
          provider === "siliconflow" ? siliconFlowProviderOptions(modelId) : undefined,
      });

      clearTimeout(timer);
      return {
        model: modelId,
        reply: result.text.trim() || "(empty reply)",
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = new Error(formatProviderError(error, provider, modelId));
    }
  }

  throw lastError ?? new Error(`${provider} health check failed.`);
}

export function healthCheckCost(model: string, inputTokens: number, outputTokens: number) {
  return estimateCost(model, inputTokens, outputTokens);
}
