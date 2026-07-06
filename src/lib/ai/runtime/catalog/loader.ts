import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeModelFamily } from "../model-aliases";
import { withEndpointKey } from "../pricing/endpoint-key";
import { buildVercelEndpointOverrides } from "../pricing/vercel-endpoint-overrides";
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
  return withEndpointKey({
    providerRoute: entry.providerRoute,
    providerName: entry.providerName,
    modelId: entry.modelId,
    normalizedModelFamily: normalizeModelFamily(entry.modelId),
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
    supportsLongContext: entry.contextWindow >= 128_000,
    enabled: entry.enabled,
    source: "manual_seed",
  });
}

export function staticCatalogOffers(): ModelEndpointOffer[] {
  const base = STATIC_MODEL_CATALOG.map(catalogEntryToOffer);
  const endpoints = buildVercelEndpointOverrides();
  const byKey = new Map(base.map((o) => [o.endpointKey!, o]));
  for (const ep of endpoints) {
    byKey.set(ep.endpointKey!, ep);
  }
  return [...byKey.values()];
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
  gatewayProviderSlug?: string,
): ModelEndpointOffer | undefined {
  const list = offers ?? cachedOffers ?? staticCatalogOffers();
  const slug = gatewayProviderSlug ?? "default";
  return list.find(
    (o) =>
      o.providerRoute === providerRoute &&
      o.modelId === modelId &&
      (o.gatewayProviderSlug ?? "default") === slug,
  );
}
