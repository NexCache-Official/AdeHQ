import type { LanguageModel } from "ai";
import { EMBEDDING_DIMENSIONS } from "@/lib/config/features";
import type {
  RuntimeEmbedParams,
  RuntimeEmbedResult,
  RuntimeGenerateObjectParams,
  RuntimeGenerateTextParams,
  RuntimeResult,
} from "../types";
import {
  buildResult,
  emptyUsage,
  schemaPlaceholderObject,
  type AiAdapter,
  type AiAdapterContext,
  type MockAdapterOptions,
} from "./base";

const CTX: AiAdapterContext = {
  providerRoute: "mock",
  providerName: "mock",
};

const MOCK_MODEL_ID = "mock/runtime-v2";

function estimateMockUsage(prompt: string, text: string) {
  const inputTokens = Math.max(1, Math.ceil(prompt.length / 4));
  const outputTokens = Math.max(1, Math.ceil(text.length / 4));
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelCostUsd: 0,
    toolCostUsd: 0,
    totalCostUsd: 0,
  };
}

export function mockDeterministicEmbedding(
  text: string,
  dimensions = EMBEDDING_DIMENSIONS,
): number[] {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const vector = new Array<number>(dimensions);
  for (let i = 0; i < dimensions; i++) {
    const seed = Math.sin((hash + i * 9973) * 0.0001);
    vector[i] = Number(seed.toFixed(6));
  }
  return vector;
}

export function createMockAdapter(options: MockAdapterOptions = {}): AiAdapter {
  return {
    route: CTX.providerRoute,
    providerName: CTX.providerName,

    chatModel(_modelId: string): LanguageModel {
      throw new Error("MockAdapter.chatModel is not used in V19.9.0a tests.");
    },

    async generateText(params: RuntimeGenerateTextParams): Promise<RuntimeResult> {
      const started = Date.now();
      const defaultText = `[mock:${params.capability}] ${params.prompt.slice(0, 120)}`;
      const text = options.generateText
        ? await options.generateText(params)
        : defaultText;
      const usage = estimateMockUsage(params.prompt, text);

      return buildResult({
        ctx: CTX,
        modelId: params.modelId ?? MOCK_MODEL_ID,
        text,
        latencyMs: Date.now() - started,
        usage: {
          ...usage,
          latencyMs: Date.now() - started,
          providerRoute: CTX.providerRoute,
          providerName: CTX.providerName,
          modelId: params.modelId ?? MOCK_MODEL_ID,
        },
      });
    },

    async generateObject<T>(params: RuntimeGenerateObjectParams<T>): Promise<RuntimeResult<T>> {
      const started = Date.now();
      const object = options.generateObject
        ? await options.generateObject(params)
        : schemaPlaceholderObject(params.schema);
      const serialized = JSON.stringify(object);
      const usage = estimateMockUsage(params.prompt, serialized);

      return buildResult({
        ctx: CTX,
        modelId: params.modelId ?? MOCK_MODEL_ID,
        object,
        latencyMs: Date.now() - started,
        usage: {
          ...usage,
          latencyMs: Date.now() - started,
          providerRoute: CTX.providerRoute,
          providerName: CTX.providerName,
          modelId: params.modelId ?? MOCK_MODEL_ID,
        },
      });
    },

    async embed(params: RuntimeEmbedParams): Promise<RuntimeEmbedResult> {
      const started = Date.now();
      const modelId = params.modelId ?? "mock-embedding";
      const embeddings = options.embed
        ? await options.embed(params)
        : params.texts.map((text) => mockDeterministicEmbedding(text));
      const serialized = embeddings.map((row) => row.join(",")).join("|");
      const usage = estimateMockUsage(params.texts.join("\n"), serialized);
      const base = emptyUsage(CTX, modelId, Date.now() - started);

      return {
        embeddings,
        usage: {
          ...base,
          ...usage,
          latencyMs: Date.now() - started,
          providerRoute: CTX.providerRoute,
          providerName: CTX.providerName,
          modelId,
        },
        finishReason: "stop",
      };
    },
  };
}
