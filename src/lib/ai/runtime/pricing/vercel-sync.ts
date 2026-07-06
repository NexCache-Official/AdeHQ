import { isVercelGatewayConfigured } from "../adapters/vercel-models";
import { withEndpointKey } from "./endpoint-key";
import { normalizeApiModel } from "./normalize";
import type { ModelEndpointOffer, PriceSnapshotInput, ProviderSyncResult } from "./types";
import {
  buildVercelEndpointOverrides,
  vercelModelsWithEndpointOverrides,
} from "./vercel-endpoint-overrides";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

type GatewayProviderRow = {
  slug?: string;
  name?: string;
  pricing?: {
    input?: string | number;
    output?: string | number;
    cachedInputTokens?: string | number;
    cacheCreationInputTokens?: string | number;
  };
  context_length?: number;
  context_window?: number;
  latency_seconds?: number;
  throughput_tps?: number;
};

type GatewayModelRow = {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  pricing?: GatewayProviderRow["pricing"];
  context_length?: number;
  context_window?: number;
  providers?: GatewayProviderRow[];
};

function parseUsdPerMillion(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n < 0.01) return n * 1_000_000;
  return n;
}

function offerFromProviderRow(
  modelId: string,
  modelName: string,
  modelType: ModelEndpointOffer["modelType"],
  provider: GatewayProviderRow,
): ModelEndpointOffer {
  const slug = provider.slug?.trim() ?? "default";
  const inputCost = parseUsdPerMillion(provider.pricing?.input);
  const outputCost = parseUsdPerMillion(provider.pricing?.output);

  const offer = normalizeApiModel({
    providerRoute: "vercel_gateway",
    providerName: "vercel",
    modelId,
    gatewayProviderSlug: slug,
    providerDisplayName: provider.name ?? slug,
    displayName: `${modelName} (${provider.name ?? slug})`,
    modelType,
    inputCostPerMillion: inputCost,
    outputCostPerMillion: outputCost,
    cacheReadCostPerMillion: parseUsdPerMillion(provider.pricing?.cachedInputTokens),
    cacheWriteCostPerMillion: parseUsdPerMillion(provider.pricing?.cacheCreationInputTokens),
    contextWindow: provider.context_length ?? provider.context_window,
    throughputTps: provider.throughput_tps,
    latencySeconds: provider.latency_seconds,
    source: inputCost != null && outputCost != null ? "vercel_api" : "manual_override",
    raw: provider as Record<string, unknown>,
  });

  if (offer.capabilities.length === 0) {
    if (modelType === "embedding") offer.capabilities = ["embedding"];
    else offer.capabilities = ["structured_chat", "summarization"];
  }
  if (offer.runtimeModes.length === 0) {
    offer.runtimeModes = modelType === "embedding" ? ["embedding"] : ["balanced"];
  }

  return withEndpointKey(offer);
}

function snapshotForOffer(offer: ModelEndpointOffer, raw: Record<string, unknown>): PriceSnapshotInput {
  return {
    providerRoute: offer.providerRoute,
    modelId: offer.modelId,
    gatewayProviderSlug: offer.gatewayProviderSlug,
    endpointKey: offer.endpointKey,
    inputCostPerMillion: offer.inputCostPerMillion,
    outputCostPerMillion: offer.outputCostPerMillion,
    cachedInputCostPerMillion: offer.cachedInputCostPerMillion ?? offer.cacheReadCostPerMillion,
    cacheWriteCostPerMillion: offer.cacheWriteCostPerMillion,
    source: offer.source,
    rawPayload: raw,
  };
}

export async function syncVercelModels(): Promise<ProviderSyncResult> {
  if (!isVercelGatewayConfigured()) {
    return {
      provider: "vercel",
      status: "skipped",
      offersAdded: 0,
      offersUpdated: 0,
      offersDisabled: 0,
      error: "AI_GATEWAY_API_KEY is not configured — skipped Vercel sync.",
      offers: [],
      snapshots: [],
    };
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY!.trim();
  const offers: ModelEndpointOffer[] = [];
  const snapshots: PriceSnapshotInput[] = [];
  const endpointOverrideModels = vercelModelsWithEndpointOverrides();

  try {
    const response = await fetch(GATEWAY_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Vercel models API failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const payload = (await response.json()) as { data?: GatewayModelRow[]; models?: GatewayModelRow[] };
    const rows = payload.data ?? payload.models ?? [];

    for (const row of rows) {
      const modelId = row.id?.trim();
      if (!modelId) continue;

      const modelType =
        row.type?.toLowerCase().includes("embed")
          ? "embedding"
          : row.type?.toLowerCase().includes("rerank")
            ? "reranker"
            : "language";

      const modelName = row.name ?? modelId;

      if (Array.isArray(row.providers) && row.providers.length > 0) {
        for (const provider of row.providers) {
          const offer = offerFromProviderRow(modelId, modelName, modelType, provider);
          offers.push(offer);
          snapshots.push(snapshotForOffer(offer, provider as Record<string, unknown>));
        }
        continue;
      }

      // Skip flat rows when curated endpoint overrides exist for this model
      if (endpointOverrideModels.has(modelId)) continue;

      const inputCost = parseUsdPerMillion(row.pricing?.input);
      const outputCost = parseUsdPerMillion(row.pricing?.output);

      const offer = withEndpointKey(
        normalizeApiModel({
          providerRoute: "vercel_gateway",
          providerName: "vercel",
          modelId,
          displayName: modelName,
          modelType,
          inputCostPerMillion: inputCost,
          outputCostPerMillion: outputCost,
          cacheReadCostPerMillion: parseUsdPerMillion(row.pricing?.cachedInputTokens),
          cacheWriteCostPerMillion: parseUsdPerMillion(row.pricing?.cacheCreationInputTokens),
          contextWindow: row.context_length ?? row.context_window,
          source: inputCost != null && outputCost != null ? "vercel_api" : "manual_override",
          raw: row as Record<string, unknown>,
        }),
      );

      if (offer.capabilities.length === 0) {
        if (modelType === "embedding") offer.capabilities = ["embedding"];
        else offer.capabilities = ["structured_chat", "summarization"];
      }
      if (offer.runtimeModes.length === 0) {
        offer.runtimeModes = modelType === "embedding" ? ["embedding"] : ["balanced"];
      }

      offers.push(offer);
      snapshots.push(snapshotForOffer(offer, row as Record<string, unknown>));
    }

    // Always merge curated endpoint overrides (authoritative for known multi-provider models)
    for (const override of buildVercelEndpointOverrides()) {
      const idx = offers.findIndex((o) => o.endpointKey === override.endpointKey);
      if (idx >= 0) offers[idx] = override;
      else offers.push(override);
      snapshots.push(snapshotForOffer(override, { manual_endpoint_override: true }));
    }

    return {
      provider: "vercel",
      status: "success",
      offersAdded: 0,
      offersUpdated: offers.length,
      offersDisabled: 0,
      offers,
      snapshots,
    };
  } catch (error) {
    // Fall back to curated endpoint overrides only
    const fallback = buildVercelEndpointOverrides();
    return {
      provider: "vercel",
      status: fallback.length ? "success" : "failed",
      offersAdded: 0,
      offersUpdated: fallback.length,
      offersDisabled: 0,
      error: error instanceof Error ? error.message : String(error),
      offers: fallback,
      snapshots: fallback.map((o) => snapshotForOffer(o, { fallback: true })),
    };
  }
}
