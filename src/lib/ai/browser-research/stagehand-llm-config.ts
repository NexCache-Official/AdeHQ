import type { V3Options } from "@browserbasehq/stagehand";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import type { CapabilityRouteDecision, RuntimeMode } from "@/lib/ai/runtime/types";
import {
  getSiliconFlowEndpointConfig,
  listSiliconFlowRuntimeModelsToTry,
  resolveSiliconFlowRuntimeModel,
} from "@/lib/ai/runtime/adapters/siliconflow";
import {
  isVercelGatewayConfigured,
  resolveVercelGatewayModelId,
} from "@/lib/ai/runtime/adapters/vercel-models";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { resolveProviderCredential } from "@/lib/providers/credentials/resolve-provider-credential";
import type { ResolvedCredential } from "@/lib/providers/credentials/types";

type StagehandModelConfiguration = NonNullable<V3Options["model"]>;

/** Stagehand act/extract uses balanced chat models — not catalog long-context picks. */
export const STAGEHAND_LLM_RUNTIME_MODE: RuntimeMode = "balanced";

export type StagehandLlmCandidate = {
  providerRoute: "siliconflow_direct" | "vercel_gateway";
  modelId: string;
  baseURL?: string;
  model: StagehandModelConfiguration;
  credential?: ResolvedCredential;
};

export async function listStagehandLlmCandidates(
  workspaceId?: string,
  runtimeMode: RuntimeMode = STAGEHAND_LLM_RUNTIME_MODE,
): Promise<StagehandLlmCandidate[]> {
  const { providerPref } = getRuntimeFlags();
  const candidates: StagehandLlmCandidate[] = [];
  const preferSiliconflow = providerPref === "auto" || providerPref === "siliconflow";
  const preferVercel = providerPref === "auto" || providerPref === "vercel";

  if (preferSiliconflow) {
    const resolved = await resolveProviderCredential({ workspaceId, provider: "siliconflow" }).catch(() => null);
    if (resolved || isSiliconFlowConfigured()) {
    const { apiKey, baseURL } = resolved
      ? { apiKey: resolved.apiKey, baseURL: resolved.baseURL }
      : getSiliconFlowEndpointConfig();
    for (const modelId of listSiliconFlowRuntimeModelsToTry({ runtimeMode })) {
      candidates.push({
        providerRoute: "siliconflow_direct",
        modelId,
        baseURL,
        credential: resolved ?? undefined,
        model: {
          modelName: `openai/${modelId}`,
          apiKey,
          baseURL,
        },
      });
    }
    }
  }

  if (preferVercel) {
    const resolved = await resolveProviderCredential({ workspaceId, provider: "vercel_gateway" }).catch(() => null);
    if (resolved || isVercelGatewayConfigured()) {
    const apiKey = resolved?.apiKey ?? process.env.AI_GATEWAY_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("AI_GATEWAY_API_KEY is not configured.");
    }
    const modelId = resolveVercelGatewayModelId({
      runtimeMode,
      capability: "browser_research",
    });
    candidates.push({
      providerRoute: "vercel_gateway",
      modelId,
      credential: resolved ?? undefined,
      model: {
        modelName: `gateway/${modelId}`,
        apiKey,
      },
    });
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      "No LLM provider configured for live browser research. Set SILICONFLOW_API_KEY or AI_GATEWAY_API_KEY.",
    );
  }

  return candidates;
}

/** Primary candidate for routing estimates / runtime logs. */
export function planBrowserResearchLlmRoute(
  _workspaceId?: string,
  _employeeId?: string,
  _query?: string,
): CapabilityRouteDecision {
  const primary = {
    providerRoute: isSiliconFlowConfigured() ? "siliconflow_direct" : "vercel_gateway",
    modelId: resolveSiliconFlowRuntimeModel({ runtimeMode: STAGEHAND_LLM_RUNTIME_MODE }),
  } as StagehandLlmCandidate;
  return {
    providerRoute: primary.providerRoute,
    providerName: primary.providerRoute === "vercel_gateway" ? "vercel" : "siliconflow",
    modelId: primary.modelId,
    runtimeMode: STAGEHAND_LLM_RUNTIME_MODE,
    capability: "browser_research",
    reasoningProfile: "medium",
    estimatedCostUsd: 0,
    estimatedWorkMinutes: 1,
    fallbackCandidates: [],
  };
}

/** @deprecated Use listStagehandLlmCandidates()[0].model */
export function buildStagehandModelConfig(
  routing: Pick<CapabilityRouteDecision, "providerRoute" | "modelId">,
): Promise<StagehandModelConfiguration> {
  return listStagehandLlmCandidates().then((candidates) => {
  const match = candidates.find(
    (candidate) =>
      candidate.providerRoute === routing.providerRoute && candidate.modelId === routing.modelId,
  );
  if (match) return match.model;
  return candidates[0]!.model;
  });
}

export function resolveSiliconFlowStagehandPrimaryModel(): string {
  return resolveSiliconFlowRuntimeModel({ runtimeMode: STAGEHAND_LLM_RUNTIME_MODE });
}
