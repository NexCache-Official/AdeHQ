import { openai } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { DEFAULT_OPENAI_MODEL } from "@/lib/config/features";
import { ModelResponseSchema } from "./schemas";
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

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export type OpenAiCallResult = {
  response: Pick<EmployeeResponse, "reply" | "effect">;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export async function callOpenAiEmployee(
  system: string,
  prompt: string,
  preferredModel?: string,
): Promise<OpenAiCallResult> {
  const models = uniqueModels(preferredModel);
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const result = await generateObject({
        model: openai(model),
        schema: ModelResponseSchema,
        system,
        prompt,
        temperature: 0.45,
      });

      return {
        response: {
          reply: result.object.reply,
          effect: {
            workLog: result.object.effects.workLog ?? [],
            tasks: result.object.effects.tasks ?? [],
            memory: result.object.effects.memory ?? [],
            approvals: result.object.effects.approvals ?? [],
            statusChange: result.object.effects.statusChange,
            handoffTo: result.object.effects.handoffTo,
            currentTask: result.object.effects.currentTask,
          },
        },
        model,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      };
    } catch (objectError) {
      lastError = objectError instanceof Error ? objectError : new Error(String(objectError));

      try {
        const textResult = await generateText({
          model: openai(model),
          system: `${system}\n\nReturn ONLY valid JSON matching this shape:\n{"reply":"string","effects":{"workLog":[],"tasks":[],"memory":[],"approvals":[]}}`,
          prompt,
          temperature: 0.45,
        });

        const parsed = ModelResponseSchema.parse(extractJson(textResult.text));
        return {
          response: {
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
          },
          model,
          inputTokens: textResult.usage?.inputTokens,
          outputTokens: textResult.usage?.outputTokens,
        };
      } catch (textError) {
        lastError = textError instanceof Error ? textError : lastError;
      }
    }
  }

  throw lastError ?? new Error("OpenAI request failed.");
}
