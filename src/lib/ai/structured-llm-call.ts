import { generateObject, generateText, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { ModelResponseSchema } from "./schemas";
import type { EmployeeResponse } from "./types";
import { parseModelResponseText, sanitizeReplyForChat } from "./normalize-model-response";

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
    memorySuggestions?: EmployeeResponse["effect"]["memorySuggestions"];
    citations?: EmployeeResponse["effect"]["citations"];
    artifacts?: EmployeeResponse["effect"]["artifacts"];
    approvals?: EmployeeResponse["effect"]["approvals"];
    emailDrafts?: EmployeeResponse["effect"]["emailDrafts"];
    toolCalls?: EmployeeResponse["effect"]["toolCalls"];
    autopilot?: EmployeeResponse["effect"]["autopilot"];
    statusChange?: EmployeeResponse["effect"]["statusChange"];
    handoffTo?: EmployeeResponse["effect"]["handoffTo"];
    currentTask?: EmployeeResponse["effect"]["currentTask"];
  };
}): Pick<EmployeeResponse, "reply" | "effect"> {
  return {
    reply: sanitizeReplyForChat(parsed.reply),
    effect: {
      workLog: parsed.effects.workLog ?? [],
      tasks: parsed.effects.tasks ?? [],
      memory: parsed.effects.memory ?? [],
      memorySuggestions: parsed.effects.memorySuggestions ?? [],
      citations: parsed.effects.citations ?? [],
      artifacts: parsed.effects.artifacts ?? [],
      approvals: parsed.effects.approvals ?? [],
      emailDrafts: parsed.effects.emailDrafts ?? [],
      toolCalls: parsed.effects.toolCalls ?? [],
      autopilot: parsed.effects.autopilot,
      statusChange: parsed.effects.statusChange,
      handoffTo: parsed.effects.handoffTo,
      currentTask: parsed.effects.currentTask,
    },
  };
}

function tier3Fallback(text: string): Pick<EmployeeResponse, "reply" | "effect"> {
  const parsed = parseModelResponseText(text);
  if (parsed) {
    return {
      reply: sanitizeReplyForChat(parsed.reply),
      effect: parsed.effect,
    };
  }

  return {
    reply: sanitizeReplyForChat(text) || "Got it — working on that.",
    effect: {
      workLog: [],
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
  providerOptions?: ProviderOptions;
  /** Use OpenAI-compatible json_object mode for tier 2 (SiliconFlow, etc.). */
  preferJsonMode?: boolean;
};

function mergeProviderOptions(
  base: ProviderOptions | undefined,
  extra: ProviderOptions,
): ProviderOptions {
  const openaiBase = base?.openai ?? {};
  const openaiExtra = extra.openai ?? {};
  return {
    ...base,
    openai: { ...openaiBase, ...openaiExtra },
  };
}

/**
 * Tier 1 (strict `generateObject` / JSON-schema mode) is skipped whenever
 * `preferJsonMode` is set. Strict mode forces `additionalProperties: false` onto
 * every object node in the converted schema — including `ToolCallEffectSchema.args`
 * and `ArtifactEffectSchema.contentJson`, both open-ended `z.record()` fields — so
 * the model is asked to satisfy a schema that forbids the very key/value pairs a
 * real tool call needs. Providers enforcing that schema server-side then hang or
 * exhaust the token budget trying to reconcile the contradiction. Tier 2's loose
 * `json_object` mode plus client-side zod validation has no such restriction.
 */
export async function callStructuredLlm(
  options: StructuredLlmOptions,
): Promise<StructuredLlmResult> {
  const {
    model,
    system,
    prompt,
    maxTokens,
    timeoutMs,
    temperature = 0.45,
    providerOptions,
    preferJsonMode = false,
  } = options;

  if (!preferJsonMode) {
    try {
      const result = await generateObject({
        model,
        schema: ModelResponseSchema,
        system,
        prompt,
        temperature,
        maxOutputTokens: maxTokens,
        abortSignal: AbortSignal.timeout(timeoutMs),
        providerOptions,
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
      // Fall through to tier 2.
    }
  }

  try {
    const jsonModeOptions = preferJsonMode
      ? mergeProviderOptions(providerOptions, {
          openai: { responseFormat: { type: "json_object" } },
        })
      : providerOptions;

    const textResult = await generateText({
      model,
      system: `${system}\n\nReturn ONLY valid JSON matching this shape:\n{"reply":"string","effects":{"workLog":[],"tasks":[],"memory":[],"memorySuggestions":[],"citations":[],"artifacts":[],"approvals":[],"emailDrafts":[],"toolCalls":[],"autopilot":{"mode":"offer","objective":"..."},"handoffTo":[]}}`,
      prompt,
      temperature,
      maxOutputTokens: maxTokens,
      abortSignal: AbortSignal.timeout(timeoutMs),
      providerOptions: jsonModeOptions,
    });

    const parsed = parseModelResponseText(textResult.text);
    if (parsed) {
      return {
        response: {
          reply: sanitizeReplyForChat(parsed.reply),
          effect: parsed.effect,
        },
        inputTokens: textResult.usage?.inputTokens,
        outputTokens: textResult.usage?.outputTokens,
        cachedTokens: (textResult.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens,
        structuredOutputUsed: true,
        fallbackTier: 2,
      };
    }

    const strict = ModelResponseSchema.safeParse(extractJson(textResult.text));
    if (strict.success) {
      return {
        response: toEffect(strict.data),
        inputTokens: textResult.usage?.inputTokens,
        outputTokens: textResult.usage?.outputTokens,
        cachedTokens: (textResult.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens,
        structuredOutputUsed: true,
        fallbackTier: 2,
      };
    }

    return {
      response: tier3Fallback(textResult.text),
      inputTokens: textResult.usage?.inputTokens,
      outputTokens: textResult.usage?.outputTokens,
      cachedTokens: (textResult.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens,
      structuredOutputUsed: false,
      fallbackTier: 3,
    };
  } catch {
    const textResult = await generateText({
      model,
      system,
      prompt,
      temperature,
      maxOutputTokens: maxTokens,
      abortSignal: AbortSignal.timeout(timeoutMs),
      providerOptions,
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
