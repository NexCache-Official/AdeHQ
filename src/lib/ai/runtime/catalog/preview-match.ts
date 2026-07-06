import type { ModelEndpointOffer } from "../pricing/types";
import { resolveCatalogOfferForRoute } from "./loader";

export type CatalogMatchPreview = {
  found: boolean;
  endpointKey?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  source?: string;
  verifiedAt?: string;
  priceFetchedAt?: string | null;
  ambiguousEndpointCount?: number;
};

export function buildCatalogMatchPreview(
  offers: ModelEndpointOffer[],
  route: {
    providerRoute: string;
    modelId: string;
    gatewayProviderSlug?: string;
    endpointKey?: string;
  },
): CatalogMatchPreview {
  const { offer, ambiguousCount } = resolveCatalogOfferForRoute(offers, route);
  if (!offer) return { found: false };

  const provenance = offer.metadata as { verifiedAt?: string } | undefined;
  return {
    found: true,
    endpointKey: offer.endpointKey,
    inputCostPerMillion: offer.inputCostPerMillion,
    outputCostPerMillion: offer.outputCostPerMillion,
    source: offer.source,
    verifiedAt: provenance?.verifiedAt,
    priceFetchedAt: offer.priceFetchedAt,
    ambiguousEndpointCount: ambiguousCount > 1 ? ambiguousCount : undefined,
  };
}
