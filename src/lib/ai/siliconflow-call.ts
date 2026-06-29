import {
  DEFAULT_SILICONFLOW_MODEL,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";
import { callStructuredLlm, type StructuredLlmResult } from "./structured-llm-call";
import { formatProviderError } from "./provider-errors";
import {
  siliconFlowChatModel,
  siliconFlowProviderOptions,
} from "./siliconflow-client";

/** Models verified via live API probes (chat/completions + JSON mode). */
const GLOBAL_FALLBACKS = [
  DEFAULT_SILICONFLOW_MODEL,
  "deepseek-ai/DeepSeek-V4-Flash",
  "deepseek-ai/DeepSeek-V3",
  "Qwen/Qwen3-8B",
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
  temperature = 0.45,
): Promise<SiliconFlowCallResult> {
  const models = uniqueModels(model);
  let lastError: Error | null = null;

  for (const modelId of models) {
    try {
      const result = await callStructuredLlm({
        model: siliconFlowChatModel(modelId),
        system,
        prompt,
        maxTokens,
        timeoutMs,
        temperature,
        providerOptions: siliconFlowProviderOptions(modelId),
        preferJsonMode: true,
      });
      return { ...result, model: modelId };
    } catch (error) {
      lastError = new Error(formatProviderError(error, "siliconflow", modelId));
    }
  }

  throw lastError ?? new Error("SiliconFlow request failed.");
}

export function siliconFlowModelsForMode(
  resolvedModel: string,
  modelMode: string,
): string[] {
  const modeFallbacks: Record<string, string[]> = {
    cheap: [SILICONFLOW_CHEAP_MODEL, "deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-8B"],
    balanced: [DEFAULT_SILICONFLOW_MODEL, "deepseek-ai/DeepSeek-V4-Flash"],
    strong: [SILICONFLOW_STRONG_MODEL, DEFAULT_SILICONFLOW_MODEL],
    long_context: [
      SILICONFLOW_LONG_CONTEXT_MODEL,
      DEFAULT_SILICONFLOW_MODEL,
      "MiniMaxAI/MiniMax-M2.5",
    ],
    coding: [SILICONFLOW_CODER_MODEL, "Qwen/Qwen3-Coder-30B-A3B-Instruct", DEFAULT_SILICONFLOW_MODEL],
  };

  const extras = modeFallbacks[modelMode] ?? [DEFAULT_SILICONFLOW_MODEL];
  return [...new Set([resolvedModel, ...extras, ...GLOBAL_FALLBACKS])];
}
