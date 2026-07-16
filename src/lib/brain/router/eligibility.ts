import {
  listBrainRoutes,
  type BrainCapability,
  type CapabilityRoute,
} from "@/lib/brain/catalog";

export type EligibilityReason =
  | "capability_unsupported"
  | "provider_unhealthy"
  | "workspace_provider_blocked"
  | "employee_permission"
  | "context_window"
  | "modality_unsupported"
  | "tools_unsupported"
  | "cost_ceiling"
  | "data_policy"
  | "environment_not_production"
  | "route_disabled";

export type EligibilityRejection = {
  routeId: string;
  reason: EligibilityReason;
};

export type EligibilityInput = {
  capability: BrainCapability;
  /** When true, shadow/evaluation/fallback routes may survive. Default false. */
  allowNonProduction?: boolean;
  unhealthyProviders?: Set<string>;
  blockedProviders?: Set<string>;
  maxCostUsd?: number;
  estimatedCostByRouteId?: Record<string, number>;
  needsTools?: boolean;
  needsLongContext?: boolean;
};

export type EligibilityResult = {
  survivors: CapabilityRoute[];
  rejections: EligibilityRejection[];
};

/**
 * Filter catalog routes before scoring.
 * Default: production primaries only. Shadow/evaluation/fallback/disabled never win live picks.
 */
export function filterEligibleRoutes(input: EligibilityInput): EligibilityResult {
  const candidates = listBrainRoutes({
    capability: input.capability,
  });
  const survivors: CapabilityRoute[] = [];
  const rejections: EligibilityRejection[] = [];

  for (const route of candidates) {
    if (route.environment === "disabled" || !route.enabled) {
      rejections.push({ routeId: route.id, reason: "route_disabled" });
      continue;
    }
    if (!input.allowNonProduction && route.environment !== "production") {
      rejections.push({ routeId: route.id, reason: "environment_not_production" });
      continue;
    }
    if (route.capability !== input.capability) {
      rejections.push({ routeId: route.id, reason: "capability_unsupported" });
      continue;
    }
    if (route.providerRoute && input.unhealthyProviders?.has(route.providerRoute)) {
      rejections.push({ routeId: route.id, reason: "provider_unhealthy" });
      continue;
    }
    if (route.providerRoute && input.blockedProviders?.has(route.providerRoute)) {
      rejections.push({ routeId: route.id, reason: "workspace_provider_blocked" });
      continue;
    }
    if (
      input.maxCostUsd != null &&
      input.estimatedCostByRouteId?.[route.id] != null &&
      input.estimatedCostByRouteId[route.id]! > input.maxCostUsd
    ) {
      rejections.push({ routeId: route.id, reason: "cost_ceiling" });
      continue;
    }
    survivors.push(route);
  }

  return { survivors, rejections };
}
