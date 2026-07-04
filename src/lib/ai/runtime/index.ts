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

function selectAdapter(
  route: ProviderRoute,
  pref: RuntimeProviderPref,
): AiAdapter {
  if (route === "mock" || pref === "mock") {
    return createMockAdapter();
  }
  if (route === "siliconflow_direct") {
    if (isSiliconFlowAdapterAvailable()) {
      return createSiliconFlowAdapter();
    }
    return createMockAdapter();
  }
  if (route === "vercel_gateway") {
    if (isVercelGatewayAdapterAvailable()) {
      return createVercelGatewayAdapter();
    }
    if (isSiliconFlowAdapterAvailable()) {
      return createSiliconFlowAdapter();
    }
    return createMockAdapter();
  }
  return createMockAdapter();
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

  const routing = routeCapability(
    {
      workspaceId: params.workspaceId,
      employeeId: params.employeeId,
      capability: params.capability,
      runtimeMode: params.runtimeMode,
      modelMode: params.modelMode,
      message: "prompt" in params ? params.prompt : undefined,
    },
    flags.providerPref,
  );

  if (isRuntimeOff(flags.mode)) {
    throw new DisabledError();
  }

  if (isRuntimeShadowMode(flags.mode)) {
    return shadowResult(routing, params);
  }

  if (!isRuntimeExecutionAllowed(flags.mode)) {
    throw new DisabledError(`Unsupported AI_RUNTIME_V2_MODE: ${flags.mode}`);
  }

  const adapter = selectAdapter(routing.providerRoute, flags.providerPref);
  const merged = {
    ...params,
    modelId: params.modelId ?? routing.modelId,
    runtimeMode: params.runtimeMode ?? routing.runtimeMode,
  };

  const result =
    kind === "text"
      ? await adapter.generateText(merged as RuntimeGenerateTextParams)
      : await adapter.generateObject(merged as RuntimeGenerateObjectParams<T>);

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

  const routing = routeCapability(
    {
      workspaceId: params.workspaceId,
      employeeId: params.employeeId,
      capability: params.capability,
      runtimeMode: params.runtimeMode ?? "embedding",
      modelMode: params.modelMode,
      message: params.texts.join("\n").slice(0, 500),
    },
    flags.providerPref,
  );

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

  const adapter = selectAdapter(routing.providerRoute, flags.providerPref);
  const merged = {
    ...params,
    modelId: params.modelId ?? routing.modelId,
    runtimeMode: params.runtimeMode ?? routing.runtimeMode,
  };

  const result = await adapter.embed(merged);
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
