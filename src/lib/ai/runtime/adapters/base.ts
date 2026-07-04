import { z } from "zod";
import type { LanguageModel } from "ai";
import type {
  ProviderRoute,
  RuntimeEmbedParams,
  RuntimeEmbedResult,
  RuntimeGenerateObjectParams,
  RuntimeGenerateTextParams,
  RuntimeResult,
} from "../types";

export type AiAdapterContext = {
  providerRoute: ProviderRoute;
  providerName: string;
};

export interface AiAdapter {
  readonly route: ProviderRoute;
  readonly providerName: string;

  chatModel(modelId: string): LanguageModel;

  generateText(params: RuntimeGenerateTextParams): Promise<RuntimeResult>;

  generateObject<T>(params: RuntimeGenerateObjectParams<T>): Promise<RuntimeResult<T>>;

  embed(params: RuntimeEmbedParams): Promise<RuntimeEmbedResult>;
}

export type MockGenerateObjectHandler = <T>(
  params: RuntimeGenerateObjectParams<T>,
) => T | Promise<T>;

export type MockGenerateTextHandler = (
  params: RuntimeGenerateTextParams,
) => string | Promise<string>;

export type MockEmbedHandler = (
  params: RuntimeEmbedParams,
) => number[][] | Promise<number[][]>;

export type MockAdapterOptions = {
  generateText?: MockGenerateTextHandler;
  generateObject?: MockGenerateObjectHandler;
  embed?: MockEmbedHandler;
};

export function emptyUsage(
  ctx: AiAdapterContext,
  modelId: string,
  latencyMs = 0,
): RuntimeResult["usage"] {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelCostUsd: 0,
    toolCostUsd: 0,
    totalCostUsd: 0,
    latencyMs,
    providerRoute: ctx.providerRoute,
    providerName: ctx.providerName,
    modelId,
  };
}

export function buildResult<T>(params: {
  ctx: AiAdapterContext;
  modelId: string;
  text?: string;
  object?: T;
  usage?: Partial<RuntimeResult["usage"]>;
  finishReason?: string;
  latencyMs?: number;
}): RuntimeResult<T> {
  const base = emptyUsage(params.ctx, params.modelId, params.latencyMs ?? 0);
  return {
    text: params.text,
    object: params.object,
    usage: { ...base, ...params.usage },
    finishReason: params.finishReason ?? "stop",
  };
}

export function schemaPlaceholderObject<T>(schema: z.ZodType<T>): T {
  const result = schema.safeParse({});
  if (result.success) return result.data;

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const draft: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      draft[key] = defaultForZodType(shape[key] as z.ZodTypeAny);
    }
    const parsed = schema.safeParse(draft);
    if (parsed.success) return parsed.data as T;
  }

  throw new Error("MockAdapter could not synthesize object for schema.");
}

function defaultForZodType(type: z.ZodTypeAny): unknown {
  if (type instanceof z.ZodString) return "mock";
  if (type instanceof z.ZodNumber) return 0;
  if (type instanceof z.ZodBoolean) return false;
  if (type instanceof z.ZodArray) {
    const item = defaultForZodType(type.element as z.ZodTypeAny);
    return [item];
  }
  if (type instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(type.shape)) {
      out[k] = defaultForZodType(v as z.ZodTypeAny);
    }
    return out;
  }
  if (type instanceof z.ZodOptional || type instanceof z.ZodNullable) {
    return defaultForZodType(type.unwrap() as z.ZodTypeAny);
  }
  if (type instanceof z.ZodDefault) {
    const def = type._def as { defaultValue?: unknown | (() => unknown) };
    const dv = def.defaultValue;
    return typeof dv === "function" ? (dv as () => unknown)() : dv;
  }
  if (type instanceof z.ZodEnum) return type.options[0];
  return null;
}
