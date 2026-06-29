import { createOpenAI } from "@ai-sdk/openai";
import {
  DEFAULT_SILICONFLOW_MODEL,
  SILICONFLOW_API_BASE_URL,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";
import { callStructuredLlm, type StructuredLlmResult } from "./structured-llm-call";
import { formatProviderError } from "./provider-errors";

function getSiliconFlowClient() {
  return createOpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY,
    baseURL: SILICONFLOW_API_BASE_URL,
  });
}

/** Models verified in SiliconFlow's public API enum (fallback order). */
const GLOBAL_FALLBACKS = [
  DEFAULT_SILICONFLOW_MODEL,
  "deepseek-ai/DeepSeek-V4-Flash",
  "Qwen/Qwen3-8B",
  "Qwen/Qwen2.5-7B-Instruct",
] as const;

function uniqueModels(preferred: string): string[] {
  return [...new Set([preferred.trim(), ...GLOBAL_FALLBACKS])];
}

export type SiliconFlowCallResult = StructuredLlmResult & {
  model: string;
};

export async function callSiliconFlowEmployee(
  system: string,
  prompt: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<SiliconFlowCallResult> {
  const siliconflow = getSiliconFlowClient();
  const models = uniqueModels(model);
  let lastError: Error | null = null;

  for (const modelId of models) {
    try {
      const result = await callStructuredLlm({
        model: siliconflow(modelId),
        system,
        prompt,
        maxTokens,
        timeoutMs,
      });
      return { ...result, model: modelId };
    } catch (error) {
      lastError = new Error(formatProviderError(error, "siliconflow", modelId));
    }
  }

  throw lastError ?? new Error("SiliconFlow request failed.");
}

/** Resolve model list for a given mode (used by health check). */
export function siliconFlowModelsForMode(
  resolvedModel: string,
  modelMode: string,
): string[] {
  const modeFallbacks: Record<string, string[]> = {
    cheap: [SILICONFLOW_CHEAP_MODEL, "Qwen/Qwen3-8B", DEFAULT_SILICONFLOW_MODEL],
    balanced: [DEFAULT_SILICONFLOW_MODEL, "deepseek-ai/DeepSeek-V4-Flash"],
    strong: [SILICONFLOW_STRONG_MODEL, DEFAULT_SILICONFLOW_MODEL],
    long_context: [SILICONFLOW_LONG_CONTEXT_MODEL, DEFAULT_SILICONFLOW_MODEL, "Qwen/Qwen2.5-72B-Instruct-128K"],
    coding: [SILICONFLOW_CODER_MODEL, "Qwen/Qwen3-Coder-30B-A3B-Instruct", DEFAULT_SILICONFLOW_MODEL],
  };

  const extras = modeFallbacks[modelMode] ?? [DEFAULT_SILICONFLOW_MODEL];
  return [...new Set([resolvedModel, ...extras, ...GLOBAL_FALLBACKS])];
}
