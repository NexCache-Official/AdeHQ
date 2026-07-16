import { embedMany, generateObject, generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { generateObjectViaJsonMode } from "./json-mode-object";
import {
  estimateCost,
  getOutputTokenCap,
  getTimeoutMs,
  normalizeModelMode,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { formatProviderError } from "@/lib/ai/provider-errors";
import type { RuntimeMode } from "../types";
import type {
  RuntimeEmbedParams,
  RuntimeEmbedResult,
  RuntimeGenerateObjectParams,
  RuntimeGenerateTextParams,
  RuntimeResult,
} from "../types";
import {
  buildResult,
  type AiAdapter,
  type AiAdapterContext,
  type MockAdapterOptions,
} from "./base";
import {
  isVercelGatewayConfigured,
  resolveVercelGatewayModelId,
} from "./vercel-models";
import type { ResolvedCredential } from "@/lib/providers/credentials/types";

const CTX: AiAdapterContext = {
  providerRoute: "vercel_gateway",
  providerName: "vercel",
};

export type VercelGatewayAdapterOptions = MockAdapterOptions;

function runtimeModeToModelMode(runtimeMode?: RuntimeMode, modelMode?: ModelMode): ModelMode {
  if (modelMode) return normalizeModelMode(modelMode);
  switch (runtimeMode) {
    case "efficient":
      return "cheap";
    case "strong":
    case "research":
      return "strong";
    case "long_context":
      return "long_context";
    case "coding":
      return "coding";
    case "balanced":
    default:
      return "balanced";
  }
}

function resolveGatewayModel(params: {
  modelId?: string;
  runtimeMode?: RuntimeMode;
  capability?: RuntimeGenerateTextParams["capability"];
}): string {
  return resolveVercelGatewayModelId({
    runtimeMode: params.runtimeMode ?? "balanced",
    capability: params.capability,
    modelId: params.modelId,
  });
}

/** Pin Vercel AI Gateway to a specific upstream provider slug (e.g. blackbox, deepinfra). */
export function buildGatewayProviderOptions(
  gatewayProviderSlug?: string,
): { gateway: { only: string[] } } | undefined {
  const slug = gatewayProviderSlug?.trim();
  if (!slug || slug === "default") return undefined;
  return { gateway: { only: [slug] } };
}

function usageFromTokens(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  latencyMs: number,
  credential?: ResolvedCredential,
): RuntimeResult["usage"] {
  const modelCostUsd = estimateCost(modelId, inputTokens, outputTokens, {
    cachedInputTokens: cachedTokens,
    providerRoute: CTX.providerRoute,
  });
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: cachedTokens,
    cacheWriteTokens: 0,
    modelCostUsd,
    toolCostUsd: 0,
    totalCostUsd: modelCostUsd,
    latencyMs,
    providerRoute: CTX.providerRoute,
    providerName: CTX.providerName,
    modelId,
    providerCredentialId: credential?.credentialId,
    providerAllocationId: credential?.allocationId,
    providerProjectId: credential?.providerProjectId,
    credentialSource: credential?.source,
  };
}

export function createVercelGatewayAdapter(
  options: VercelGatewayAdapterOptions = {},
  credential?: ResolvedCredential,
): AiAdapter {
  const apiKey = credential?.apiKey ?? process.env.AI_GATEWAY_API_KEY?.trim();
  const withGatewayApiKey = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!credential?.apiKey) return fn();
    const previous = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = credential.apiKey;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = previous;
    }
  };
  return {
    route: CTX.providerRoute,
    providerName: CTX.providerName,

    chatModel(modelId: string) {
      return gateway(modelId);
    },

    async generateText(params: RuntimeGenerateTextParams): Promise<RuntimeResult> {
      const modelId = resolveGatewayModel(params);
      const modelMode = runtimeModeToModelMode(params.runtimeMode, params.modelMode);
      const maxTokens = params.maxTokens ?? getOutputTokenCap(modelMode);
      const timeoutMs = params.timeoutMs ?? getTimeoutMs(modelMode);
      const temperature = params.temperature ?? 0.45;
      const system = params.system ?? "";
      const prompt = params.prompt;
      const started = Date.now();

      if (options.generateText) {
        const text = await options.generateText(params);
        return buildResult({
          ctx: CTX,
          modelId,
          text,
          latencyMs: Date.now() - started,
          usage: usageFromTokens(
            modelId,
            Math.max(1, Math.ceil(prompt.length / 4)),
            Math.max(1, Math.ceil(text.length / 4)),
            0,
            Date.now() - started,
            credential,
          ),
        });
      }

      if (!apiKey) {
        throw new Error("AI_GATEWAY_API_KEY is not configured.");
      }

      try {
        const providerOptions = buildGatewayProviderOptions(params.gatewayProviderSlug);
        const result = await withGatewayApiKey(() => generateText({
          model: gateway(modelId),
          system,
          prompt,
          temperature,
          maxOutputTokens: maxTokens,
          abortSignal: AbortSignal.timeout(timeoutMs),
          ...(providerOptions ? { providerOptions } : {}),
        }));

        const inputTokens = result.usage?.inputTokens ?? 0;
        const outputTokens = result.usage?.outputTokens ?? 0;
        const cached =
          (result.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens ?? 0;

        return buildResult({
          ctx: CTX,
          modelId,
          text: result.text,
          latencyMs: Date.now() - started,
          usage: usageFromTokens(modelId, inputTokens, outputTokens, cached, Date.now() - started, credential),
          finishReason: result.finishReason,
        });
      } catch (error) {
        throw new Error(formatProviderError(error, "vercel", modelId));
      }
    },

    async generateObject<T>(params: RuntimeGenerateObjectParams<T>): Promise<RuntimeResult<T>> {
      const modelId = resolveGatewayModel(params);
      const modelMode = runtimeModeToModelMode(params.runtimeMode, params.modelMode);
      const maxTokens = params.maxTokens ?? getOutputTokenCap(modelMode);
      const timeoutMs = params.timeoutMs ?? getTimeoutMs(modelMode);
      const temperature = params.temperature ?? 0.45;
      const system = params.system ?? "";
      const prompt = params.prompt;
      const started = Date.now();

      if (options.generateObject) {
        const object = await options.generateObject(params);
        const serialized = JSON.stringify(object);
        return buildResult({
          ctx: CTX,
          modelId,
          object,
          latencyMs: Date.now() - started,
          usage: usageFromTokens(
            modelId,
            Math.max(1, Math.ceil(prompt.length / 4)),
            Math.max(1, Math.ceil(serialized.length / 4)),
            0,
            Date.now() - started,
            credential,
          ),
        });
      }

      if (!apiKey) {
        throw new Error("AI_GATEWAY_API_KEY is not configured.");
      }

      try {
        const gatewayProviderOptions = buildGatewayProviderOptions(params.gatewayProviderSlug);
        const outcome = params.preferJsonMode
          ? await withGatewayApiKey(() =>
              generateObjectViaJsonMode({
                model: gateway(modelId),
                schema: params.schema,
                system,
                prompt,
                maxTokens,
                timeoutMs,
                temperature,
                frequencyPenalty: params.frequencyPenalty,
                presencePenalty: params.presencePenalty,
                providerOptions: gatewayProviderOptions,
              }),
            )
          : await withGatewayApiKey(() =>
              generateObject({
                model: gateway(modelId),
                schema: params.schema,
                system,
                prompt,
                temperature,
                maxOutputTokens: maxTokens,
                frequencyPenalty: params.frequencyPenalty,
                presencePenalty: params.presencePenalty,
                abortSignal: AbortSignal.timeout(timeoutMs),
                ...(gatewayProviderOptions ? { providerOptions: gatewayProviderOptions } : {}),
              }),
            ).then((result) => ({
              object: result.object,
              inputTokens: result.usage?.inputTokens ?? 0,
              outputTokens: result.usage?.outputTokens ?? 0,
              cachedTokens:
                (result.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens ?? 0,
              finishReason: result.finishReason,
            }));

        return buildResult({
          ctx: CTX,
          modelId,
          object: outcome.object,
          latencyMs: Date.now() - started,
          usage: usageFromTokens(
            modelId,
            outcome.inputTokens,
            outcome.outputTokens,
            outcome.cachedTokens,
            Date.now() - started,
            credential,
          ),
          finishReason: outcome.finishReason,
        });
      } catch (error) {
        throw new Error(formatProviderError(error, "vercel", modelId));
      }
    },

    async embed(params: RuntimeEmbedParams): Promise<RuntimeEmbedResult> {
      const modelId = resolveGatewayModel(params);
      const inputs = params.texts.map((text) => text.trim()).filter(Boolean);
      const started = Date.now();

      if (!inputs.length) {
        return {
          embeddings: [],
          usage: usageFromTokens(modelId, 0, 0, 0, 0, credential),
        };
      }

      if (options.embed) {
        const embeddings = await options.embed(params);
        const serialized = embeddings.map((row) => row.join(",")).join("|");
        return {
          embeddings,
          usage: usageFromTokens(
            modelId,
            Math.max(1, Math.ceil(params.texts.join("\n").length / 4)),
            Math.max(1, Math.ceil(serialized.length / 4)),
            0,
            Date.now() - started,
            credential,
          ),
          finishReason: "stop",
        };
      }

      if (!apiKey) {
        throw new Error("AI_GATEWAY_API_KEY is not configured.");
      }

      try {
        const result = await withGatewayApiKey(() => embedMany({
          model: gateway.embeddingModel(modelId),
          values: inputs,
          abortSignal: AbortSignal.timeout(30_000),
        }));

        const inputTokens = result.usage?.tokens ?? Math.max(1, Math.ceil(inputs.join(" ").length / 4));
        return {
          embeddings: result.embeddings,
          usage: usageFromTokens(modelId, inputTokens, 0, 0, Date.now() - started, credential),
          finishReason: "stop",
        };
      } catch (error) {
        throw new Error(formatProviderError(error, "vercel", modelId));
      }
    },
  };
}

export function isVercelGatewayAdapterAvailable(): boolean {
  return isVercelGatewayConfigured();
}
