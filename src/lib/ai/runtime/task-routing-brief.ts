import type { RoutingPreference } from "@/lib/ai/intelligence-policy";
import { resolveEmployeeIntelligencePolicy } from "@/lib/ai/intelligence-policy";
import type { AIEmployee } from "@/lib/types";
import type { EmbeddingProfile } from "./pricing/types";
import type {
  AiCapability,
  CapabilityRouteInput,
  ProviderRoute,
  ReasoningProfile,
  RuntimeMode,
  RuntimeProviderPref,
} from "./types";

export type TaskRoutingBrief = {
  capability: AiCapability;
  runtimeMode: RuntimeMode;
  reasoningProfile?: ReasoningProfile;
  requiredContextTokens?: number;
  requiresJson?: boolean;
  requiresTools?: boolean;
  requiresEmbedding?: boolean;
  routingPreference: RoutingPreference;
  providerPreference: RuntimeProviderPref;
  riskLevel?: "low" | "medium" | "high";
  currentRoute?: {
    providerRoute: ProviderRoute;
    modelId: string;
    gatewayProviderSlug?: string;
    endpointKey?: string;
  };
  promptTokenEstimate?: number;
  maxOutputTokens?: number;
  embeddingProfile?: EmbeddingProfile;
};

function capabilityNeedsJson(capability: AiCapability): boolean {
  return (
    capability === "classification" ||
    capability === "structured_chat" ||
    capability === "artifact_generation" ||
    capability === "research_planning"
  );
}

function estimateContextTokens(input: CapabilityRouteInput): number | undefined {
  if (input.contextSize) return input.contextSize;
  if (input.message) return Math.max(256, Math.ceil(input.message.length / 4));
  return undefined;
}

export function buildTaskRoutingBrief(
  input: CapabilityRouteInput,
  options?: {
    employee?: Pick<AIEmployee, "intelligencePolicy" | "roleKey" | "modelMode"> | null;
    providerPreference?: RuntimeProviderPref;
    requiresJson?: boolean;
    currentRoute?: TaskRoutingBrief["currentRoute"];
    embeddingProfile?: EmbeddingProfile;
  },
): TaskRoutingBrief {
  const policy = options?.employee
    ? resolveEmployeeIntelligencePolicy(options.employee)
    : null;

  const runtimeMode = input.runtimeMode ?? "balanced";
  const capability = input.capability;
  const maxOutput = input.needsLongContext ? 2000 : 800;
  const contextEstimate = estimateContextTokens(input);

  return {
    capability,
    runtimeMode,
    reasoningProfile: input.needsReasoning ? "medium" : undefined,
    requiredContextTokens: input.needsLongContext
      ? Math.max(contextEstimate ?? 8000, 8000)
      : contextEstimate,
    requiresJson: options?.requiresJson ?? capabilityNeedsJson(capability),
    requiresTools: input.needsTools,
    requiresEmbedding: capability === "embedding",
    routingPreference: (policy?.routingPreference ?? input.routingPreference ?? "auto") as RoutingPreference,
    providerPreference: options?.providerPreference ?? "auto",
    riskLevel: input.riskLevel,
    currentRoute: options?.currentRoute ?? input.currentRoute,
    promptTokenEstimate: contextEstimate,
    maxOutputTokens: maxOutput,
    embeddingProfile:
      options?.embeddingProfile ??
      (capability === "embedding" ? "pinned_bge" : undefined),
  };
}
