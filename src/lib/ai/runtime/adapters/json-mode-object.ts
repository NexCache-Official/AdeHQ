import { generateText, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { z } from "zod";

function extractJsonCandidate(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Models sometimes copy an illustrative example from the prompt too literally —
 * e.g. echoing a `{"mode":"offer","objective":""}` placeholder for an optional
 * field that doesn't apply to this reply — which fails validation on an
 * otherwise-correct response. Since these fields are optional, drop whichever
 * object directly contains the invalid leaf (one repair pass, schema-agnostic)
 * and re-validate, instead of rejecting the whole response over one bad field.
 */
function repairAndRevalidate<T>(
  schema: z.ZodType<T>,
  candidate: unknown,
  error: z.ZodError,
): ReturnType<typeof schema.safeParse> {
  if (candidate === null || typeof candidate !== "object") {
    return schema.safeParse(candidate);
  }
  const repaired = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>;
  let changed = false;

  for (const issue of error.issues) {
    let node: Record<string, unknown> | undefined = repaired;
    for (let i = 0; i < issue.path.length - 1 && node; i++) {
      const key = issue.path[i] as string;
      if (i === issue.path.length - 2) {
        if (key in node) {
          delete node[key];
          changed = true;
        }
        break;
      }
      node = node[key] as Record<string, unknown> | undefined;
    }
  }

  return schema.safeParse(changed ? repaired : candidate);
}

export type JsonModeObjectResult<T> = {
  object: T;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  finishReason?: string;
};

export type JsonModeObjectOptions<T> = {
  model: LanguageModel;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  temperature: number;
  providerOptions?: ProviderOptions;
  /** Set OpenAI-compatible response_format:"json_object" (SiliconFlow/OpenAI-style endpoints only). */
  useOpenAiJsonObjectFormat?: boolean;
  frequencyPenalty?: number;
  presencePenalty?: number;
};

/**
 * Structured-output path that avoids the AI SDK's strict `generateObject` JSON-schema
 * mode. Strict mode forces `additionalProperties: false` onto every object node in the
 * converted JSON schema — including open-ended `z.record()` fields such as tool-call
 * `args` or artifact `contentJson` — which makes it impossible for the model to emit any
 * key/value pair into them without violating the schema it was just given. Providers that
 * enforce that schema server-side (constrained decoding) then hang or burn their entire
 * token budget trying to satisfy the contradiction whenever a real tool call needs args.
 * This path instead asks for loose JSON and validates client-side with the real zod
 * schema, which has no such restriction on records.
 */
export async function generateObjectViaJsonMode<T>(
  options: JsonModeObjectOptions<T>,
): Promise<JsonModeObjectResult<T>> {
  const providerOptions = options.useOpenAiJsonObjectFormat
    ? {
        ...options.providerOptions,
        openai: {
          ...options.providerOptions?.openai,
          responseFormat: { type: "json_object" },
        },
      }
    : options.providerOptions;

  const textResult = await generateText({
    model: options.model,
    system: `${options.system}\n\nReturn ONLY valid JSON matching the required shape. No markdown fences, no commentary before or after the JSON.`,
    prompt: options.prompt,
    temperature: options.temperature,
    maxOutputTokens: options.maxTokens,
    frequencyPenalty: options.frequencyPenalty,
    presencePenalty: options.presencePenalty,
    abortSignal: AbortSignal.timeout(options.timeoutMs),
    providerOptions,
  });

  const candidate = extractJsonCandidate(textResult.text);
  let parsed = options.schema.safeParse(candidate);
  if (!parsed.success) {
    parsed = repairAndRevalidate(options.schema, candidate, parsed.error);
  }
  if (!parsed.success) {
    throw new Error(`JSON-mode object failed schema validation: ${parsed.error.message}`);
  }

  return {
    object: parsed.data,
    inputTokens: textResult.usage?.inputTokens ?? 0,
    outputTokens: textResult.usage?.outputTokens ?? 0,
    cachedTokens:
      (textResult.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens ?? 0,
    finishReason: textResult.finishReason,
  };
}
