import { openai } from "@ai-sdk/openai";
import { DEFAULT_OPENAI_MODEL } from "@/lib/config/features";
import { callStructuredLlm, type StructuredLlmResult } from "./structured-llm-call";
import type { EmployeeResponse } from "./types";

const MODEL_FALLBACKS = [
  DEFAULT_OPENAI_MODEL,
  "gpt-5.4-mini-2026-03-17",
  "gpt-4o-mini",
] as const;

function uniqueModels(preferred?: string) {
  const list = preferred?.trim()
    ? [preferred.trim(), ...MODEL_FALLBACKS]
    : [...MODEL_FALLBACKS];
  return [...new Set(list)];
}

export type OpenAiCallResult = StructuredLlmResult & {
  model: string;
  response: Pick<EmployeeResponse, "reply" | "effect">;
};

export async function callOpenAiEmployee(
  system: string,
  prompt: string,
  preferredModel?: string,
  maxTokens = 2000,
  timeoutMs = 45_000,
): Promise<OpenAiCallResult> {
  const models = uniqueModels(preferredModel);
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const result = await callStructuredLlm({
        model: openai(model),
        system,
        prompt,
        maxTokens,
        timeoutMs,
      });
      return { ...result, model };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("OpenAI request failed.");
}
