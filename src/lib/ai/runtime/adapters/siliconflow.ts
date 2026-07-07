import { generateObject, generateText } from "ai";
import {
  estimateCost,
  getOutputTokenCap,
  getTimeoutMs,
  normalizeModelMode,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import {
  DEFAULT_EMBEDDING_MODEL,
  SILICONFLOW_API_BASE_URL,
} from "@/lib/config/features";
import {
  siliconFlowChatModel,
  siliconFlowProviderOptions,
} from "@/lib/ai/siliconflow-client";
import { siliconFlowModelsForMode } from "@/lib/ai/siliconflow-call";
import { formatProviderError } from "@/lib/ai/provider-errors";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import type { ResolvedCredential } from "@/lib/providers/credentials/types";
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
} from "./base";

const CTX: AiAdapterContext = {
  providerRoute: "siliconflow_direct",
  providerName: "siliconflow",
};

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

function resolveSiliconFlowModel(params: {
  modelId?: string;
  runtimeMode?: RuntimeMode;
  modelMode?: ModelMode;
}): string {
  if (params.modelId?.trim()) return params.modelId.trim();
  const mode = runtimeModeToModelMode(params.runtimeMode, params.modelMode);
  return resolveModel("siliconflow", mode);
}

function modelsToTry(preferred: string, modelMode: ModelMode): string[] {
  return siliconFlowModelsForMode(preferred, modelMode);
}

/** Shared SiliconFlow endpoint — same baseURL + auth as siliconFlowChatModel(). */
export function getSiliconFlowEndpointConfig(): { apiKey: string; baseURL: string } {
  if (!isSiliconFlowConfigured()) {
    throw new Error("SILICONFLOW_API_KEY is not configured.");
  }
  return {
    apiKey: process.env.SILICONFLOW_API_KEY!.trim(),
    baseURL: SILICONFLOW_API_BASE_URL,
  };
}

/** Resolve model id the same way generateText/generateObject do in this adapter. */
export function resolveSiliconFlowRuntimeModel(params: {
  modelId?: string;
  runtimeMode?: RuntimeMode;
  modelMode?: ModelMode;
}): string {
  return resolveSiliconFlowModel(params);
}

/** Ordered model ids to try — same fallback chain as live runtime calls. */
export function listSiliconFlowRuntimeModelsToTry(params: {
  modelId?: string;
  runtimeMode?: RuntimeMode;
  modelMode?: ModelMode;
}): string[] {
  const modelMode = runtimeModeToModelMode(params.runtimeMode, params.modelMode);
  const preferred = resolveSiliconFlowModel(params);
  return modelsToTry(preferred, modelMode);
}

function usageFromTokens(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  latencyMs: number,
  credential?: ResolvedCredential,
): RuntimeResult["usage"] {
  const modelCostUsd = estimateCost(modelId, inputTokens, outputTokens);
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

export function createSiliconFlowAdapter(credential?: ResolvedCredential): AiAdapter {
  const apiKey = credential?.apiKey ?? process.env.SILICONFLOW_API_KEY?.trim();
  const baseURL = credential?.baseURL ?? SILICONFLOW_API_BASE_URL;
  return {
    route: CTX.providerRoute,
    providerName: CTX.providerName,

    chatModel(modelId: string) {
      return siliconFlowChatModel(modelId, { apiKey, baseURL });
    },

    async generateText(params: RuntimeGenerateTextParams): Promise<RuntimeResult> {
      if (!apiKey) {
        throw new Error("SILICONFLOW_API_KEY is not configured.");
      }

      const modelMode = runtimeModeToModelMode(params.runtimeMode, params.modelMode);
      const preferred = resolveSiliconFlowModel(params);
      const maxTokens = params.maxTokens ?? getOutputTokenCap(modelMode);
      const timeoutMs = params.timeoutMs ?? getTimeoutMs(modelMode);
      const temperature = params.temperature ?? 0.45;
      const system = params.system ?? "";
      const prompt = params.prompt;

      let lastError: Error | null = null;
      const started = Date.now();

      for (const modelId of modelsToTry(preferred, modelMode)) {
        try {
          const result = await generateText({
            model: siliconFlowChatModel(modelId, { apiKey, baseURL }),
            system,
            prompt,
            temperature,
            maxOutputTokens: maxTokens,
            abortSignal: AbortSignal.timeout(timeoutMs),
            providerOptions: siliconFlowProviderOptions(modelId),
          });

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
          lastError = new Error(formatProviderError(error, "siliconflow", modelId));
        }
      }

      throw lastError ?? new Error("SiliconFlow request failed.");
    },

    async generateObject<T>(params: RuntimeGenerateObjectParams<T>): Promise<RuntimeResult<T>> {
      if (!apiKey) {
        throw new Error("SILICONFLOW_API_KEY is not configured.");
      }

      const modelMode = runtimeModeToModelMode(params.runtimeMode, params.modelMode);
      const preferred = resolveSiliconFlowModel(params);
      const maxTokens = params.maxTokens ?? getOutputTokenCap(modelMode);
      const timeoutMs = params.timeoutMs ?? getTimeoutMs(modelMode);
      const temperature = params.temperature ?? 0.45;
      const system = params.system ?? "";
      const prompt = params.prompt;

      let lastError: Error | null = null;
      const started = Date.now();

      for (const modelId of modelsToTry(preferred, modelMode)) {
        try {
          const result = await generateObject({
            model: siliconFlowChatModel(modelId, { apiKey, baseURL }),
            schema: params.schema,
            system,
            prompt,
            temperature,
            maxOutputTokens: maxTokens,
            abortSignal: AbortSignal.timeout(timeoutMs),
            providerOptions: siliconFlowProviderOptions(modelId),
          });

          const inputTokens = result.usage?.inputTokens ?? 0;
          const outputTokens = result.usage?.outputTokens ?? 0;
          const cached =
            (result.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens ?? 0;

          return buildResult({
            ctx: CTX,
            modelId,
            object: result.object,
            latencyMs: Date.now() - started,
            usage: usageFromTokens(modelId, inputTokens, outputTokens, cached, Date.now() - started, credential),
            finishReason: result.finishReason,
          });
        } catch (error) {
          lastError = new Error(formatProviderError(error, "siliconflow", modelId));
        }
      }

      throw lastError ?? new Error("SiliconFlow request failed.");
    },

    async embed(params: RuntimeEmbedParams): Promise<RuntimeEmbedResult> {
      if (!apiKey) {
        throw new Error("SILICONFLOW_API_KEY is not configured.");
      }

      const modelId = params.modelId?.trim() || DEFAULT_EMBEDDING_MODEL;
      const inputs = params.texts.map((text) => text.trim()).filter(Boolean);
      if (!inputs.length) {
        return {
          embeddings: [],
          usage: usageFromTokens(modelId, 0, 0, 0, 0, credential),
        };
      }

      const started = Date.now();
      const response = await fetch(`${baseURL}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          input: inputs,
          encoding_format: "float",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? `Embedding request failed (${response.status}).`);
      }

      const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const embeddings = rows.map((row) => row.embedding ?? []).filter((vec) => vec.length > 0);
      if (embeddings.length !== inputs.length) {
        throw new Error("Embedding response count mismatch.");
      }

      const inputTokens = Math.max(1, Math.ceil(inputs.join(" ").length / 4));
      return {
        embeddings,
        usage: usageFromTokens(modelId, inputTokens, 0, 0, Date.now() - started, credential),
        finishReason: "stop",
      };
    },
  };
}

export function isSiliconFlowAdapterAvailable(): boolean {
  return isSiliconFlowConfigured();
}
