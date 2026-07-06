import { isVercelGatewayConfigured } from "../adapters/vercel-models";
import { normalizeApiModel } from "./normalize";
import type { ModelEndpointOffer, PriceSnapshotInput, ProviderSyncResult } from "./types";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

type GatewayModelRow = {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  pricing?: {
    input?: string | number;
    output?: string | number;
    cachedInputTokens?: string | number;
    cacheCreationInputTokens?: string | number;
  };
  context_length?: number;
  context_window?: number;
};

function parseUsdPerMillion(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Gateway may return per-token; heuristics: values < 0.01 are per-token
  if (n < 0.01) return n * 1_000_000;
  return n;
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

    const offers: ModelEndpointOffer[] = [];
    const snapshots: PriceSnapshotInput[] = [];

    for (const row of rows) {
      const modelId = row.id?.trim();
      if (!modelId) continue;

      const modelType =
        row.type?.toLowerCase().includes("embed")
          ? "embedding"
          : row.type?.toLowerCase().includes("rerank")
            ? "reranker"
            : "language";

      const inputCost = parseUsdPerMillion(row.pricing?.input);
      const outputCost = parseUsdPerMillion(row.pricing?.output);

      const offer = normalizeApiModel({
        providerRoute: "vercel_gateway",
        providerName: "vercel",
        modelId,
        displayName: row.name ?? modelId,
        modelType,
        inputCostPerMillion: inputCost,
        outputCostPerMillion: outputCost,
        cacheReadCostPerMillion: parseUsdPerMillion(row.pricing?.cachedInputTokens),
        cacheWriteCostPerMillion: parseUsdPerMillion(row.pricing?.cacheCreationInputTokens),
        contextWindow: row.context_length ?? row.context_window,
        source: inputCost != null && outputCost != null ? "vercel_api" : "manual_override",
        raw: row as Record<string, unknown>,
      });

      if (offer.capabilities.length === 0) {
        if (modelType === "embedding") offer.capabilities = ["embedding"];
        else offer.capabilities = ["structured_chat", "summarization"];
      }
      if (offer.runtimeModes.length === 0) {
        offer.runtimeModes = modelType === "embedding" ? ["embedding"] : ["balanced"];
      }

      offers.push(offer);
      snapshots.push({
        providerRoute: "vercel_gateway",
        modelId,
        inputCostPerMillion: offer.inputCostPerMillion,
        outputCostPerMillion: offer.outputCostPerMillion,
        cachedInputCostPerMillion: offer.cacheReadCostPerMillion,
        cacheWriteCostPerMillion: offer.cacheWriteCostPerMillion,
        source: offer.source,
        rawPayload: row as Record<string, unknown>,
      });
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
    return {
      provider: "vercel",
      status: "failed",
      offersAdded: 0,
      offersUpdated: 0,
      offersDisabled: 0,
      error: error instanceof Error ? error.message : String(error),
      offers: [],
      snapshots: [],
    };
  }
}
