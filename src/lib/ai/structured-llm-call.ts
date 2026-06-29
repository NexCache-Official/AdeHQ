import { generateObject, generateText, type LanguageModel } from "ai";
import { ModelResponseSchema } from "./schemas";
import type { EmployeeResponse } from "./types";

export type StructuredLlmResult = {
  response: Pick<EmployeeResponse, "reply" | "effect">;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  structuredOutputUsed: boolean;
  fallbackTier: 1 | 2 | 3;
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(candidate.slice(start, end + 1));
}

function toEffect(parsed: {
  reply: string;
  effects: {
    workLog?: EmployeeResponse["effect"]["workLog"];
    tasks?: EmployeeResponse["effect"]["tasks"];
    memory?: EmployeeResponse["effect"]["memory"];
    approvals?: EmployeeResponse["effect"]["approvals"];
    statusChange?: EmployeeResponse["effect"]["statusChange"];
    handoffTo?: EmployeeResponse["effect"]["handoffTo"];
    currentTask?: EmployeeResponse["effect"]["currentTask"];
  };
}): Pick<EmployeeResponse, "reply" | "effect"> {
  return {
    reply: parsed.reply,
    effect: {
      workLog: parsed.effects.workLog ?? [],
      tasks: parsed.effects.tasks ?? [],
      memory: parsed.effects.memory ?? [],
      approvals: parsed.effects.approvals ?? [],
      statusChange: parsed.effects.statusChange,
      handoffTo: parsed.effects.handoffTo,
      currentTask: parsed.effects.currentTask,
    },
  };
}

function tier3Fallback(text: string): Pick<EmployeeResponse, "reply" | "effect"> {
  return {
    reply: text.trim() || "I processed your request but could not structure the full response.",
    effect: {
      workLog: [
        {
          action: "Structured output fallback",
          summary: "Returned natural language reply after structured parse failed.",
          status: "success",
        },
      ],
      tasks: [],
      memory: [],
      approvals: [],
    },
  };
}

export type StructuredLlmOptions = {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
};

export async function callStructuredLlm(
  options: StructuredLlmOptions,
): Promise<StructuredLlmResult> {
  const { model, system, prompt, maxTokens, timeoutMs, temperature = 0.45 } = options;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    try {
      const result = await generateObject({
        model,
        schema: ModelResponseSchema,
        system,
        prompt,
        temperature,
        maxOutputTokens: maxTokens,
        abortSignal: abortController.signal,
      });

      return {
        response: toEffect(result.object),
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        cachedTokens: (result.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens,
        structuredOutputUsed: true,
        fallbackTier: 1,
      };
    } catch {
      try {
        const textResult = await generateText({
          model,
          system: `${system}\n\nReturn ONLY valid JSON matching this shape:\n{"reply":"string","effects":{"workLog":[],"tasks":[],"memory":[],"approvals":[]}}`,
          prompt,
          temperature,
          maxOutputTokens: maxTokens,
          abortSignal: abortController.signal,
        });

        const parsed = ModelResponseSchema.parse(extractJson(textResult.text));
        return {
          response: toEffect(parsed),
          inputTokens: textResult.usage?.inputTokens,
          outputTokens: textResult.usage?.outputTokens,
          cachedTokens: (textResult.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens,
          structuredOutputUsed: true,
          fallbackTier: 2,
        };
      } catch {
        const textResult = await generateText({
          model,
          system,
          prompt,
          temperature,
          maxOutputTokens: maxTokens,
          abortSignal: abortController.signal,
        });

        return {
          response: tier3Fallback(textResult.text),
          inputTokens: textResult.usage?.inputTokens,
          outputTokens: textResult.usage?.outputTokens,
          cachedTokens: (textResult.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens,
          structuredOutputUsed: false,
          fallbackTier: 3,
        };
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
