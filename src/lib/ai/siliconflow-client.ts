import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";

/** SiliconFlow only supports Chat Completions — not OpenAI's /responses API. */
export function getSiliconFlowClient() {
  return createOpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY,
    baseURL: SILICONFLOW_API_BASE_URL,
  });
}

export function siliconFlowChatModel(modelId: string): LanguageModel {
  return getSiliconFlowClient().chat(modelId);
}

/** Qwen models default to thinking mode and can burn tokens / break JSON output. */
export function siliconFlowProviderOptions(modelId: string): ProviderOptions | undefined {
  if (modelId.includes("Qwen") || modelId.includes("qwen")) {
    return { openai: { extraBody: { enable_thinking: false } } };
  }
  return undefined;
}
