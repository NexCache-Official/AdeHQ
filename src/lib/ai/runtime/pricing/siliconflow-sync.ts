import { SILICONFLOW_API_BASE_URL, isSiliconFlowConfigured } from "@/lib/config/features";
import { MANUAL_MODEL_OVERRIDES } from "./manual-overrides";
import { normalizeApiModel } from "./normalize";
import type { ModelEndpointOffer, PriceSnapshotInput, ProviderSyncResult } from "./types";

type SiliconFlowModelRow = {
  id?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  type?: string;
  subtype?: string;
  pricing?: {
    input?: number | string;
    output?: number | string;
  };
  context_length?: number;
};

export async function syncSiliconFlowModels(): Promise<ProviderSyncResult> {
  if (!isSiliconFlowConfigured()) {
    return {
      provider: "siliconflow",
      status: "skipped",
      offersAdded: 0,
      offersUpdated: 0,
      offersDisabled: 0,
      error: "SILICONFLOW_API_KEY is not configured — skipped SiliconFlow sync.",
      offers: [],
      snapshots: [],
    };
  }

  const apiKey = process.env.SILICONFLOW_API_KEY!.trim();

  try {
    const response = await fetch(`${SILICONFLOW_API_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`SiliconFlow models API failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const payload = (await response.json()) as { data?: SiliconFlowModelRow[] };
    const rows = payload.data ?? [];

    const offers: ModelEndpointOffer[] = [];
    const snapshots: PriceSnapshotInput[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const modelId = row.id?.trim();
      if (!modelId) continue;
      seen.add(modelId);

      const subtype = (row.subtype ?? row.type ?? "").toLowerCase();
      const modelType = subtype.includes("embed")
        ? "embedding"
        : subtype.includes("rerank")
          ? "reranker"
          : "language";

      const inputCost = parsePrice(row.pricing?.input);
      const outputCost = parsePrice(row.pricing?.output);
      const hasApiPricing = inputCost != null && outputCost != null;

      const offer = normalizeApiModel({
        providerRoute: "siliconflow_direct",
        providerName: "siliconflow",
        modelId,
        displayName: modelId.split("/").pop() ?? modelId,
        modelType,
        inputCostPerMillion: inputCost,
        outputCostPerMillion: outputCost,
        contextWindow: row.context_length,
        source: hasApiPricing ? "siliconflow_api" : "manual_override",
        raw: row as Record<string, unknown>,
      });

      if (modelType === "embedding") {
        offer.capabilities = ["embedding"];
        offer.runtimeModes = ["embedding"];
        offer.supportsEmbeddings = true;
        offer.supportsJson = false;
      } else if (offer.capabilities.length === 0) {
        offer.capabilities = ["structured_chat", "summarization"];
        offer.runtimeModes = ["balanced"];
      }

      offers.push(offer);
      snapshots.push({
        providerRoute: "siliconflow_direct",
        modelId,
        inputCostPerMillion: offer.inputCostPerMillion,
        outputCostPerMillion: offer.outputCostPerMillion,
        source: offer.source,
        rawPayload: row as Record<string, unknown>,
      });
    }

    // Ensure manual overrides for known models are present even if API list differs
    for (const manual of MANUAL_MODEL_OVERRIDES.filter((o) => o.providerRoute === "siliconflow_direct")) {
      if (!seen.has(manual.modelId)) {
        offers.push({ ...manual, source: "manual_override" });
        snapshots.push({
          providerRoute: manual.providerRoute,
          modelId: manual.modelId,
          inputCostPerMillion: manual.inputCostPerMillion,
          outputCostPerMillion: manual.outputCostPerMillion,
          source: "manual_override",
          rawPayload: { manual: true },
        });
      }
    }

    return {
      provider: "siliconflow",
      status: "success",
      offersAdded: 0,
      offersUpdated: offers.length,
      offersDisabled: 0,
      offers,
      snapshots,
    };
  } catch (error) {
    // Fall back to manual overrides only
    const manualOffers = MANUAL_MODEL_OVERRIDES.filter((o) => o.providerRoute === "siliconflow_direct");
    return {
      provider: "siliconflow",
      status: manualOffers.length ? "success" : "failed",
      offersAdded: 0,
      offersUpdated: manualOffers.length,
      offersDisabled: 0,
      error: error instanceof Error ? error.message : String(error),
      offers: manualOffers,
      snapshots: manualOffers.map((o) => ({
        providerRoute: o.providerRoute,
        modelId: o.modelId,
        inputCostPerMillion: o.inputCostPerMillion,
        outputCostPerMillion: o.outputCostPerMillion,
        source: "manual_override",
        rawPayload: { fallback: true },
      })),
    };
  }
}

function parsePrice(value: number | string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
