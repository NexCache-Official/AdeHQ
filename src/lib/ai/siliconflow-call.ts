import {
  DEFAULT_SILICONFLOW_MODEL,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";
import { streamText } from "ai";
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

export type SiliconFlowTextStreamResult = {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * Streaming plain-prose employee reply via SiliconFlow using `streamText`.
 *
 * SiliconFlow's OpenAI-compatible endpoint does not stream JSON/structured
 * output (streamObject hangs), so streaming is plain text only — used for
 * conversational quick replies whose effects are empty. Streams the preferred
 * model; on failure the caller reverts to the blocking structured path.
 */
export async function streamSiliconFlowText(
  system: string,
  prompt: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
  temperature = 0.45,
  onReplyDelta: (delta: string) => void,
  externalSignal?: AbortSignal,
): Promise<SiliconFlowTextStreamResult> {
  const modelId = model.trim() || DEFAULT_SILICONFLOW_MODEL;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const onExternalAbort = () => abortController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) abortController.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    const result = streamText({
      model: siliconFlowChatModel(modelId),
      system,
      prompt,
      temperature,
      maxOutputTokens: maxTokens,
      abortSignal: abortController.signal,
      providerOptions: siliconFlowProviderOptions(modelId),
    });

    let text = "";
    for await (const delta of result.textStream) {
      if (abortController.signal.aborted) {
        throw new Error("Stream aborted");
      }
      if (!delta) continue;
      text += delta;
      onReplyDelta(delta);
    }

    const usage = await result.usage;
    return {
      text,
      model: modelId,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    };
  } catch (error) {
    if (
      abortController.signal.aborted ||
      (error instanceof Error && /abort/i.test(error.message))
    ) {
      const abortErr = new Error("Stream aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    throw new Error(formatProviderError(error, "siliconflow", modelId));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export function siliconFlowModelsForMode(
  resolvedModel: string,
  modelMode: string,
): string[] {
  const modeFallbacks: Record<string, string[]> = {
    cheap: [SILICONFLOW_CHEAP_MODEL, "deepseek-ai/DeepSeek-V4-Flash", "Qwen/Qwen3-8B"],
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
