import type { ModelEndpointOffer } from "./types";

export const DEFAULT_GATEWAY_PROVIDER_SLUG = "default";

/** Stable catalog sync key: provider_route:model_id:gateway_provider_slug_or_default */
export function buildEndpointKey(
  providerRoute: string,
  modelId: string,
  gatewayProviderSlug?: string | null,
): string {
  const slug = gatewayProviderSlug?.trim() || DEFAULT_GATEWAY_PROVIDER_SLUG;
  return `${providerRoute}:${modelId}:${slug}`;
}

export function resolveEndpointKey(offer: Pick<ModelEndpointOffer, "providerRoute" | "modelId" | "gatewayProviderSlug" | "endpointKey">): string {
  return offer.endpointKey ?? buildEndpointKey(offer.providerRoute, offer.modelId, offer.gatewayProviderSlug);
}

export function withEndpointKey<T extends ModelEndpointOffer>(offer: T): T {
  const gatewayProviderSlug = offer.gatewayProviderSlug ?? DEFAULT_GATEWAY_PROVIDER_SLUG;
  const endpointKey = offer.endpointKey ?? buildEndpointKey(offer.providerRoute, offer.modelId, gatewayProviderSlug);
  return {
    ...offer,
    gatewayProviderSlug,
    endpointKey,
  };
}
