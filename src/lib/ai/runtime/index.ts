import { isBrainV1Enabled } from "@/lib/brain/flags";
import { routeCapabilityV2 } from "@/lib/brain/router";
import { loadEnabledOffers } from "./catalog/loader";
import { routeCapability } from "./capability-router";
import {
  getRuntimeFlags,
  isRuntimeExecutionAllowed,
  isRuntimeOff,
  isRuntimeShadowMode,
} from "./flags";
import { createMockAdapter } from "./adapters/mock";
import {
  createSiliconFlowAdapter,
  isSiliconFlowAdapterAvailable,
} from "./adapters/siliconflow";
import {
  createVercelGatewayAdapter,
  isVercelGatewayAdapterAvailable,
} from "./adapters/vercel-gateway";
import type { AiAdapter } from "./adapters/base";
import { resolveProviderCredential } from "@/lib/providers/credentials/resolve-provider-credential";
import { recordCredentialEvent } from "@/lib/providers/credentials/record-credential-event";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import type { ManagedProviderId, ResolvedCredential } from "@/lib/providers/credentials/types";
import type {
  CapabilityRouteDecision,
  ProviderRoute,
  RuntimeEmbedParams,
  RuntimeEmbedResult,
  RuntimeGenerateObjectParams,
  RuntimeGenerateTextParams,
  RuntimeProviderPref,
  RuntimeResult,
  RuntimeV2Mode,
} from "./types";
import { RuntimeDisabledError as DisabledError } from "./types";

export type RuntimeInvokeOptions = {
  forceMode?: RuntimeV2Mode;
  forceProviderPref?: RuntimeProviderPref;
};

async function resolveCatalogOffers(): Promise<import("./pricing/types").ModelEndpointOffer[] | undefined> {
  try {
    const { createSupabaseSecretClient } = await import("@/lib/supabase/server");
    const client = createSupabaseSecretClient();
    return await loadEnabledOffers(client);
  } catch {
    return undefined;
  }
}

function selectAdapter(
  route: ProviderRoute,
  pref: RuntimeProviderPref,
  credential?: ResolvedCredential,
): AiAdapter {
  if (route === "mock" || pref === "mock") {
    return createMockAdapter();
  }
  if (route === "siliconflow_direct") {
    if (credential || isSiliconFlowAdapterAvailable()) {
      return createSiliconFlowAdapter(credential);
    }
    return createMockAdapter();
  }
  if (route === "vercel_gateway") {
    if (credential || isVercelGatewayAdapterAvailable()) {
      return createVercelGatewayAdapter({}, credential);
    }
    if (isSiliconFlowAdapterAvailable()) {
      return createSiliconFlowAdapter();
    }
    return createMockAdapter();
  }
  return createMockAdapter();
}

function providerForRoute(route: ProviderRoute): ManagedProviderId | null {
  switch (route) {
    case "siliconflow_direct":
      return "siliconflow";
    case "vercel_gateway":
      return "vercel_gateway";
    default:
      return null;
  }
}

async function resolveCredentialForRoute(
  workspaceId: string | undefined,
  route: ProviderRoute,
): Promise<ResolvedCredential | undefined> {
  const provider = providerForRoute(route);
  if (!provider) return undefined;
  return resolveProviderCredential({ workspaceId, provider }).catch((error) => {
    console.warn("[AdeHQ runtime credentials]", error);
    return undefined;
  });
}

function recordRuntimeCredentialUse(
  credential: ResolvedCredential | undefined,
  workspaceId: string | undefined,
  failed?: boolean,
  error?: unknown,
): void {
  if (!credential?.credentialId) return;
  try {
    const client = createSupabaseSecretClient();
    void recordCredentialEvent(client, {
      credentialId: credential.credentialId,
      workspaceId,
      provider: credential.provider,
      eventType: failed ? "failed" : "used",
      reason: failed ? (error instanceof Error ? error.message : String(error ?? "Runtime provider failed.")) : undefined,
      metadata: { source: credential.source },
    });
  } catch {
    // Non-fatal: usage/cost ledger remains the source of truth.
  }
}

function shadowResult<T>(
  routing: CapabilityRouteDecision,
  params: RuntimeGenerateTextParams | RuntimeGenerateObjectParams<T>,
): RuntimeResult<T> {
  return {
    shadow: true,
    routing,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      modelCostUsd: routing.estimatedCostUsd,
      toolCostUsd: 0,
      totalCostUsd: routing.estimatedCostUsd,
      latencyMs: 0,
      providerRoute: routing.providerRoute,
      providerName: routing.providerName,
      modelId: routing.modelId,
    },
    workMinutesEstimated: routing.estimatedWorkMinutes,
    finishReason: "shadow",
    text: "shadow" in params ? undefined : undefined,
  };
}

async function invokeWithRouting<T>(
  params: RuntimeGenerateTextParams | RuntimeGenerateObjectParams<T>,
  kind: "text" | "object",
  options?: RuntimeInvokeOptions,
): Promise<RuntimeResult<T>> {
  const flags = getRuntimeFlags({
    mode: options?.forceMode,
    providerPref: options?.forceProviderPref,
  });

  const catalogOffers = await resolveCatalogOffers();
  const routeInput = {
    workspaceId: params.workspaceId,
    employeeId: params.employeeId,
    capability: params.capability,
    runtimeMode: params.runtimeMode,
    modelMode: params.modelMode,
    intensity: params.intensity,
    message: "prompt" in params ? params.prompt : undefined,
    routingPreference: params.routingPreference,
    requiresJson: params.requiresJson ?? ("schema" in params),
    needsLongContext: Boolean(params.metadata?.needsLongContext),
    catalogOffers,
  };
  // Brain V1: eligibility + intensity USD ranges on the live hot path.
  const routing = isBrainV1Enabled()
    ? routeCapabilityV2(routeInput, flags.providerPref)
    : routeCapability(routeInput, flags.providerPref);

  if (isRuntimeOff(flags.mode)) {
    throw new DisabledError();
  }

  if (isRuntimeShadowMode(flags.mode)) {
    return shadowResult(routing, params);
  }

  if (!isRuntimeExecutionAllowed(flags.mode)) {
    throw new DisabledError(`Unsupported AI_RUNTIME_V2_MODE: ${flags.mode}`);
  }

  const credential = await resolveCredentialForRoute(params.workspaceId, routing.providerRoute);
  const adapter = selectAdapter(routing.providerRoute, flags.providerPref, credential);
  const merged = {
    ...params,
    modelId: params.modelId ?? routing.modelId,
    runtimeMode: params.runtimeMode ?? routing.runtimeMode,
    gatewayProviderSlug: params.gatewayProviderSlug ?? routing.gatewayProviderSlug,
    endpointKey: params.endpointKey ?? routing.endpointKey,
  };

  let result: RuntimeResult<T>;
  try {
    result =
      kind === "text"
        ? ((await adapter.generateText(merged as RuntimeGenerateTextParams)) as RuntimeResult<T>)
        : await adapter.generateObject(merged as RuntimeGenerateObjectParams<T>);
    recordRuntimeCredentialUse(credential, params.workspaceId);
  } catch (error) {
    recordRuntimeCredentialUse(credential, params.workspaceId, true, error);
    throw error;
  }

  return {
    ...(result as RuntimeResult<T>),
    routing,
    workMinutesEstimated: routing.estimatedWorkMinutes,
  };
}

/** Generate plain text via Runtime V2. Requires AI_RUNTIME_V2_MODE=on (or forceMode in tests). */
export async function generateText(
  params: RuntimeGenerateTextParams,
  options?: RuntimeInvokeOptions,
): Promise<RuntimeResult> {
  return invokeWithRouting(params, "text", options);
}

/** Generate structured object via Runtime V2. Requires AI_RUNTIME_V2_MODE=on (or forceMode in tests). */
export async function generateObject<T>(
  params: RuntimeGenerateObjectParams<T>,
  options?: RuntimeInvokeOptions,
): Promise<RuntimeResult<T>> {
  return invokeWithRouting(params, "object", options);
}

/** Generate embeddings via Runtime V2. Requires AI_RUNTIME_V2_MODE=on (or forceMode in tests). */
export async function embed(
  params: RuntimeEmbedParams,
  options?: RuntimeInvokeOptions,
): Promise<RuntimeEmbedResult> {
  const flags = getRuntimeFlags({
    mode: options?.forceMode,
    providerPref: options?.forceProviderPref,
  });

  const catalogOffers = await resolveCatalogOffers();
  const routeInput = {
    workspaceId: params.workspaceId,
    employeeId: params.employeeId,
    capability: params.capability,
    runtimeMode: params.runtimeMode ?? "embedding" as const,
    modelMode: params.modelMode,
    intensity: params.intensity,
    message: params.texts.join("\n").slice(0, 500),
    catalogOffers,
  };
  const routing = isBrainV1Enabled()
    ? routeCapabilityV2(routeInput, flags.providerPref)
    : routeCapability(routeInput, flags.providerPref);

  if (isRuntimeOff(flags.mode)) {
    throw new DisabledError();
  }

  if (isRuntimeShadowMode(flags.mode)) {
    return {
      embeddings: [],
      shadow: true,
      routing,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        modelCostUsd: routing.estimatedCostUsd,
        toolCostUsd: 0,
        totalCostUsd: routing.estimatedCostUsd,
        latencyMs: 0,
        providerRoute: routing.providerRoute,
        providerName: routing.providerName,
        modelId: routing.modelId,
      },
      workMinutesEstimated: routing.estimatedWorkMinutes,
      finishReason: "shadow",
    };
  }

  if (!isRuntimeExecutionAllowed(flags.mode)) {
    throw new DisabledError(`Unsupported AI_RUNTIME_V2_MODE: ${flags.mode}`);
  }

  const credential = await resolveCredentialForRoute(params.workspaceId, routing.providerRoute);
  const adapter = selectAdapter(routing.providerRoute, flags.providerPref, credential);
  const merged = {
    ...params,
    modelId: params.modelId ?? routing.modelId,
    runtimeMode: params.runtimeMode ?? routing.runtimeMode,
    gatewayProviderSlug: params.gatewayProviderSlug ?? routing.gatewayProviderSlug,
    endpointKey: params.endpointKey ?? routing.endpointKey,
  };

  let result: RuntimeEmbedResult;
  try {
    result = await adapter.embed(merged);
    recordRuntimeCredentialUse(credential, params.workspaceId);
  } catch (error) {
    recordRuntimeCredentialUse(credential, params.workspaceId, true, error);
    throw error;
  }
  return {
    ...result,
    routing,
    workMinutesEstimated: routing.estimatedWorkMinutes,
  };
}

/** Plan route/cost without executing (works in any mode except off). */
export function planRoute(
  input: Parameters<typeof routeCapability>[0],
  options?: RuntimeInvokeOptions,
): CapabilityRouteDecision {
  const flags = getRuntimeFlags({
    mode: options?.forceMode,
    providerPref: options?.forceProviderPref,
  });
  if (isRuntimeOff(flags.mode)) {
    throw new DisabledError("Cannot plan route while AI_RUNTIME_V2_MODE=off.");
  }
  // Brain V1: eligibility + USD ranges. Kill switch restores legacy scoring-only path.
  // Metering is never gated by this flag.
  if (isBrainV1Enabled()) {
    return routeCapabilityV2(input, flags.providerPref);
  }
  return routeCapability(input, flags.providerPref);
}

export {
  getRuntimeFlags,
  isRuntimeExecutionAllowed,
  isRuntimeOff,
  isRuntimeShadowMode,
  routeCapability,
  createMockAdapter,
  createSiliconFlowAdapter,
  createVercelGatewayAdapter,
  isSiliconFlowAdapterAvailable,
  isVercelGatewayAdapterAvailable,
  DisabledError as RuntimeDisabledError,
};

export type {
  AiCapability,
  CapabilityRouteDecision,
  CapabilityRouteInput,
  ProviderRoute,
  ReasoningProfile,
  RuntimeEmbedParams,
  RuntimeEmbedResult,
  RuntimeGenerateObjectParams,
  RuntimeGenerateTextParams,
  RuntimeProviderPref,
  RuntimeResult,
  RuntimeUsage,
  RuntimeV2Mode,
} from "./types";
