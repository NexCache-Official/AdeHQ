import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";

/**
 * Models that default to extended "thinking" mode on SiliconFlow and can burn the
 * entire output token budget on hidden reasoning tokens, leaving little/nothing
 * for the actual answer (observed: DeepSeek-V4-Flash returning 1400 reasoning
 * tokens vs 1 text token, hitting finishReason "length" and failing structured
 * output entirely — the root cause of employee replies falling back to a much
 * weaker model, the topic-summary background job failing outright, and CRM/task/
 * artifact tool-calling requests aborting after ~100s). SiliconFlow normalizes
 * `enable_thinking` across these hosted models.
 */
function modelDefaultsToThinkingMode(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("qwen") || id.includes("deepseek") || id.includes("minimax");
}

/**
 * Rewrites outgoing SiliconFlow chat-completions requests to disable thinking
 * mode for models that default to it.
 *
 * This does NOT go through `providerOptions.openai` — that object is strictly
 * validated by the AI SDK against a fixed Zod schema (no "extraBody" or
 * passthrough field exists on it), so a custom key like `enable_thinking` is
 * silently stripped before the request is ever built and never reaches
 * SiliconFlow's API. The only way to actually set a non-standard body field is
 * to intercept the request at the fetch layer, which every call — generateText,
 * generateObject, streamText, and every fallback tier — goes through identically.
 */
function createThinkingModeFetch(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string") {
      return baseFetch(input, init);
    }
    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      const model = parsed.model;
      if (
        typeof model === "string" &&
        modelDefaultsToThinkingMode(model) &&
        parsed.enable_thinking === undefined
      ) {
        return baseFetch(input, {
          ...init,
          body: JSON.stringify({ ...parsed, enable_thinking: false }),
        });
      }
    } catch {
      // Not a JSON body (or unexpected shape) — send through untouched.
    }
    return baseFetch(input, init);
  };
}

/** SiliconFlow only supports Chat Completions — not OpenAI's /responses API. */
export function getSiliconFlowClient(config?: { apiKey?: string; baseURL?: string }) {
  return createOpenAI({
    apiKey: config?.apiKey ?? process.env.SILICONFLOW_API_KEY,
    baseURL: config?.baseURL ?? SILICONFLOW_API_BASE_URL,
    fetch: createThinkingModeFetch(fetch),
  });
}

export function siliconFlowChatModel(
  modelId: string,
  config?: { apiKey?: string; baseURL?: string },
): LanguageModel {
  return getSiliconFlowClient(config).chat(modelId);
}

/**
 * @deprecated No-op. Kept only so the many existing `providerOptions:
 * siliconFlowProviderOptions(modelId)` call sites keep compiling — passing
 * `undefined` as providerOptions is harmless everywhere it's used. The actual
 * thinking-mode fix now lives in {@link createThinkingModeFetch} above, since
 * this function's old `extraBody` shape was silently dropped by the AI SDK and
 * never reached SiliconFlow.
 */
export function siliconFlowProviderOptions(_modelId: string): ProviderOptions | undefined {
  return undefined;
}
