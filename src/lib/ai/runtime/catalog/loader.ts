import type { SupabaseClient } from "@supabase/supabase-js";
import { STATIC_MODEL_CATALOG, type CatalogModelEntry } from "./seed";
import { listCatalogOffersFromDb } from "@/lib/supabase/model-catalog";
import type { ModelEndpointOffer } from "../pricing/types";

const DEFAULT_TTL_MS = 300_000;

let cachedOffers: ModelEndpointOffer[] | null = null;
let cachedAt = 0;

function readCacheTtlMs(): number {
  const raw = Number(process.env.AI_MODEL_CATALOG_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

function catalogEntryToOffer(entry: CatalogModelEntry): ModelEndpointOffer {
  return {
    providerRoute: entry.providerRoute,
    providerName: entry.providerName,
    modelId: entry.modelId,
    normalizedModelFamily: entry.modelId.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    displayName: entry.displayName,
    modelType: entry.capabilities.includes("embedding") ? "embedding" : "language",
    capabilities: entry.capabilities,
    runtimeModes:
      entry.capabilities.includes("embedding")
        ? ["embedding"]
        : entry.displayName.toLowerCase().includes("efficient")
          ? ["efficient"]
          : entry.displayName.toLowerCase().includes("strong")
            ? ["strong", "research"]
            : entry.displayName.toLowerCase().includes("long")
              ? ["long_context", "research"]
              : entry.displayName.toLowerCase().includes("coder") ||
                  entry.displayName.toLowerCase().includes("coding")
                ? ["coding"]
                : ["balanced"],
    contextWindow: entry.contextWindow,
    inputCostPerMillion: entry.inputCostPerMillion,
    outputCostPerMillion: entry.outputCostPerMillion,
    currency: "USD",
    supportsJson: !entry.capabilities.includes("embedding"),
    supportsTools: entry.providerRoute === "vercel_gateway",
    supportsEmbeddings: entry.capabilities.includes("embedding"),
    supportsLongContext: entry.contextWindow >= 200_000,
    enabled: entry.enabled,
    source: "manual_seed",
  };
}

export function staticCatalogOffers(): ModelEndpointOffer[] {
  return STATIC_MODEL_CATALOG.map(catalogEntryToOffer);
}

export function invalidateCatalogCache(): void {
  cachedOffers = null;
  cachedAt = 0;
}

export async function loadEnabledOffers(client?: SupabaseClient | null): Promise<ModelEndpointOffer[]> {
  const ttl = readCacheTtlMs();
  const now = Date.now();
  if (cachedOffers && now - cachedAt < ttl) {
    return cachedOffers;
  }

  if (client) {
    try {
      const offers = await listCatalogOffersFromDb(client, { enabledOnly: true });
      if (offers.length > 0) {
        cachedOffers = offers;
        cachedAt = now;
        return offers;
      }
    } catch (error) {
      console.warn("[AdeHQ catalog loader] DB load failed — using static seed.", error);
    }
  }

  const fallback = staticCatalogOffers().filter((o) => o.enabled);
  cachedOffers = fallback;
  cachedAt = now;
  return fallback;
}

export function getOfferFromCache(
  providerRoute: string,
  modelId: string,
  offers?: ModelEndpointOffer[],
): ModelEndpointOffer | undefined {
  const list = offers ?? cachedOffers ?? staticCatalogOffers();
  return list.find((o) => o.providerRoute === providerRoute && o.modelId === modelId);
}
