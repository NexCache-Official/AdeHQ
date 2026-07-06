import type { ModelMode } from "@/lib/ai/model-catalog";
import {
  DEFAULT_EMBEDDING_MODEL,
  isSiliconFlowConfigured,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";
import { isVercelGatewayConfigured } from "./adapters/vercel-models";
import { buildEndpointKey } from "./pricing/endpoint-key";
import { isMockFallbackAllowed } from "./route-optimizer";
import type { AiCapability, ProviderRoute, RuntimeMode } from "./types";

export type PinnedPolicyKey =
  | "cheap"
  | "balanced"
  | "strong"
  | "long_context"
  | "coding"
  | "embedding";

export type PinnedRouteSpec = {
  providerRoute: ProviderRoute;
  modelId: string;
  gatewayProviderSlug: string | null;
};

export const PINNED_PROVIDER_POLICY_V2012: Record<PinnedPolicyKey, PinnedRouteSpec> = {
  cheap: {
    providerRoute: "siliconflow_direct",
    modelId: SILICONFLOW_CHEAP_MODEL,
    gatewayProviderSlug: null,
  },
  balanced: {
    providerRoute: "siliconflow_direct",
    modelId: "deepseek-ai/DeepSeek-V4-Flash",
    gatewayProviderSlug: null,
  },
  strong: {
    providerRoute: "vercel_gateway",
    modelId: "deepseek/deepseek-v4-pro",
    gatewayProviderSlug: "deepseek",
  },
  long_context: {
    providerRoute: "vercel_gateway",
    modelId: "minimax/minimax-m2.5",
    gatewayProviderSlug: "deepinfra",
  },
  coding: {
    providerRoute: "siliconflow_direct",
    modelId: SILICONFLOW_CODER_MODEL,
    gatewayProviderSlug: null,
  },
  embedding: {
    providerRoute: "siliconflow_direct",
    modelId: DEFAULT_EMBEDDING_MODEL,
    gatewayProviderSlug: null,
  },
};

/** SF fallbacks when Vercel Gateway is unavailable. */
export const PINNED_GATEWAY_SF_FALLBACKS: Partial<Record<PinnedPolicyKey, PinnedRouteSpec>> = {
  strong: {
    providerRoute: "siliconflow_direct",
    modelId: SILICONFLOW_STRONG_MODEL,
    gatewayProviderSlug: null,
  },
  long_context: {
    providerRoute: "siliconflow_direct",
    modelId: SILICONFLOW_LONG_CONTEXT_MODEL,
    gatewayProviderSlug: null,
  },
};

/** Long-context fallback order when primary Vercel DeepInfra route is unavailable. */
export const LONG_CONTEXT_FALLBACK_CHAIN: PinnedRouteSpec[] = [
  {
    providerRoute: "vercel_gateway",
    modelId: "minimax/minimax-m2.5",
    gatewayProviderSlug: "deepinfra",
  },
  {
    providerRoute: "vercel_gateway",
    modelId: "minimax/minimax-m2.5",
    gatewayProviderSlug: "minimax",
  },
  {
    providerRoute: "siliconflow_direct",
    modelId: SILICONFLOW_LONG_CONTEXT_MODEL,
    gatewayProviderSlug: null,
  },
];

export const PINNED_POLICY_REASON = "pinned provider policy";

export function modelModeToPinnedPolicyKey(modelMode: ModelMode): PinnedPolicyKey {
  switch (modelMode) {
    case "cheap":
      return "cheap";
    case "strong":
      return "strong";
    case "long_context":
      return "long_context";
    case "coding":
      return "coding";
    case "creative":
    case "balanced":
    default:
      return "balanced";
  }
}

export type ResolvedPinnedRoute = PinnedRouteSpec & {
  policyKey: PinnedPolicyKey;
  endpointKey: string;
  gatewayFallbackApplied: boolean;
  reason: string;
};

function toEndpointKey(spec: PinnedRouteSpec): string {
  return buildEndpointKey(spec.providerRoute, spec.modelId, spec.gatewayProviderSlug);
}

function specNeedsGateway(spec: PinnedRouteSpec): boolean {
  return spec.providerRoute === "vercel_gateway";
}

function specNeedsSiliconFlow(spec: PinnedRouteSpec): boolean {
  return spec.providerRoute === "siliconflow_direct";
}

export type ResolvePinnedRouteOptions = {
  providerPref?: "auto" | "siliconflow" | "vercel" | "mock";
  gatewayAvailable?: boolean;
  siliconflowAvailable?: boolean;
};

export function resolvePinnedPolicyRouteByKey(
  policyKey: PinnedPolicyKey,
  opts: ResolvePinnedRouteOptions = {},
): ResolvedPinnedRoute {
  const gatewayAvailable = opts.gatewayAvailable ?? isVercelGatewayConfigured();
  const siliconflowAvailable = opts.siliconflowAvailable ?? isSiliconFlowConfigured();
  const providerPref = opts.providerPref ?? "auto";

  if (providerPref === "mock" && isMockFallbackAllowed()) {
    return {
      policyKey,
      providerRoute: "mock",
      modelId: `mock-${policyKey}`,
      gatewayProviderSlug: null,
      endpointKey: buildEndpointKey("mock", `mock-${policyKey}`),
      gatewayFallbackApplied: false,
      reason: PINNED_POLICY_REASON,
    };
  }

  let spec = { ...PINNED_PROVIDER_POLICY_V2012[policyKey] };
  let gatewayFallbackApplied = false;

  if (specNeedsGateway(spec) && !gatewayAvailable) {
    const sfFallback = PINNED_GATEWAY_SF_FALLBACKS[policyKey];
    if (sfFallback) {
      spec = { ...sfFallback };
      gatewayFallbackApplied = true;
    } else if (siliconflowAvailable) {
      spec = {
        providerRoute: "siliconflow_direct",
        modelId: spec.modelId,
        gatewayProviderSlug: null,
      };
      gatewayFallbackApplied = true;
    }
  }

  if (specNeedsSiliconFlow(spec) && !siliconflowAvailable) {
    if (gatewayAvailable && (policyKey === "strong" || policyKey === "long_context")) {
      spec = { ...PINNED_PROVIDER_POLICY_V2012[policyKey] };
    } else if (gatewayAvailable) {
      spec = {
        providerRoute: "vercel_gateway",
        modelId: spec.modelId.includes("/")
          ? spec.modelId
          : `openai/gpt-4o-mini`,
        gatewayProviderSlug: "default",
      };
    } else if (isMockFallbackAllowed()) {
      return {
        policyKey,
        providerRoute: "mock",
        modelId: `mock-${policyKey}`,
        gatewayProviderSlug: null,
        endpointKey: buildEndpointKey("mock", `mock-${policyKey}`),
        gatewayFallbackApplied: true,
        reason: PINNED_POLICY_REASON,
      };
    }
  }

  if (providerPref === "siliconflow" && spec.providerRoute === "vercel_gateway") {
    const sfFallback = PINNED_GATEWAY_SF_FALLBACKS[policyKey];
    if (sfFallback && siliconflowAvailable) {
      spec = { ...sfFallback };
      gatewayFallbackApplied = true;
    }
  }

  if (providerPref === "vercel" && spec.providerRoute === "siliconflow_direct" && gatewayAvailable) {
    const vercelPinned = PINNED_PROVIDER_POLICY_V2012[policyKey];
    if (vercelPinned.providerRoute === "vercel_gateway") {
      spec = { ...vercelPinned };
    }
  }

  return {
    policyKey,
    ...spec,
    endpointKey: toEndpointKey(spec),
    gatewayFallbackApplied,
    reason: gatewayFallbackApplied
      ? `${PINNED_POLICY_REASON} (gateway unavailable — SiliconFlow fallback)`
      : PINNED_POLICY_REASON,
  };
}

export function buildPinnedFallbackCandidates(
  policyKey: PinnedPolicyKey,
  primary: ResolvedPinnedRoute,
): Array<{
  providerRoute: ProviderRoute;
  modelId: string;
  gatewayProviderSlug?: string;
  endpointKey?: string;
}> {
  const candidates: Array<{
    providerRoute: ProviderRoute;
    modelId: string;
    gatewayProviderSlug?: string;
    endpointKey?: string;
  }> = [];

  if (policyKey === "long_context") {
    for (const spec of LONG_CONTEXT_FALLBACK_CHAIN) {
      const key = toEndpointKey(spec);
      if (key === primary.endpointKey) continue;
      candidates.push({
        providerRoute: spec.providerRoute,
        modelId: spec.modelId,
        gatewayProviderSlug: spec.gatewayProviderSlug ?? undefined,
        endpointKey: key,
      });
    }
    return candidates;
  }

  if (primary.providerRoute === "vercel_gateway" && isSiliconFlowConfigured()) {
    const sfFallback = PINNED_GATEWAY_SF_FALLBACKS[policyKey];
    if (sfFallback) {
      candidates.push({
        providerRoute: sfFallback.providerRoute,
        modelId: sfFallback.modelId,
        endpointKey: toEndpointKey(sfFallback),
      });
    }
  } else if (primary.providerRoute === "siliconflow_direct" && isVercelGatewayConfigured()) {
    const vercelSpec = PINNED_PROVIDER_POLICY_V2012[policyKey];
    if (vercelSpec.providerRoute === "vercel_gateway") {
      candidates.push({
        providerRoute: vercelSpec.providerRoute,
        modelId: vercelSpec.modelId,
        gatewayProviderSlug: vercelSpec.gatewayProviderSlug ?? undefined,
        endpointKey: toEndpointKey(vercelSpec),
      });
    }
  }

  if (isMockFallbackAllowed()) {
    candidates.push({ providerRoute: "mock", modelId: "mock/runtime-v2" });
  }

  return candidates;
}

/** Resolve pinned route from a runtime model mode label. */
export function resolvePinnedPolicyRoute(
  modelMode: ModelMode,
  opts: ResolvePinnedRouteOptions = {},
): ResolvedPinnedRoute {
  return resolvePinnedPolicyRouteByKey(modelModeToPinnedPolicyKey(modelMode), opts);
}

export function pinnedPolicyKeyForCapability(
  capability: AiCapability,
  modelMode: ModelMode,
  runtimeMode: RuntimeMode,
): PinnedPolicyKey {
  if (capability === "embedding" || runtimeMode === "embedding") return "embedding";
  if (capability === "long_context" || runtimeMode === "long_context") return "long_context";
  if (capability === "coding" || runtimeMode === "coding") return "coding";
  if (
    capability === "deep_reasoning" ||
    capability === "research_planning" ||
    runtimeMode === "strong" ||
    runtimeMode === "research"
  ) {
    return "strong";
  }
  if (
    capability === "quick_reply" ||
    capability === "classification" ||
    capability === "memory_curation" ||
    runtimeMode === "efficient"
  ) {
    return "cheap";
  }
  return modelModeToPinnedPolicyKey(modelMode);
}
