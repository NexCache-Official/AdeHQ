import type { z } from "zod";
import type { ModelMode } from "@/lib/ai/model-catalog";

/** Internal capability categories for routing (Runtime V2). */
export type AiCapability =
  | "quick_reply"
  | "structured_chat"
  | "reasoning"
  | "deep_reasoning"
  | "long_context"
  | "coding"
  | "research_planning"
  | "browser_research"
  | "artifact_generation"
  | "memory_curation"
  | "summarization"
  | "classification"
  | "embedding"
  | "reranking"
  | "image_generation"
  | "speech_to_text"
  | "text_to_speech";

/** User-facing runtime mode labels (maps to ModelMode where applicable). */
export type RuntimeMode =
  | "efficient"
  | "balanced"
  | "strong"
  | "long_context"
  | "coding"
  | "research"
  | "multimodal"
  | "speech"
  | "embedding"
  | "reranking";

export type ReasoningProfile = "none" | "low" | "medium" | "high" | "max";

export type ProviderRoute = "vercel_gateway" | "siliconflow_direct" | "mock";

export type RuntimeV2Mode = "off" | "shadow" | "on";

export type RuntimeProviderPref = "auto" | "siliconflow" | "vercel" | "mock";

export type RuntimeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type RuntimeBudgetPolicy = {
  maxCostPerCallUsd?: number;
  maxWorkMinutesPerCall?: number;
};

export type RuntimeBaseParams = {
  workspaceId?: string;
  employeeId?: string;
  workUnitId?: string;
  capability: AiCapability;
  runtimeMode?: RuntimeMode;
  modelMode?: ModelMode;
  reasoningProfile?: ReasoningProfile;
  budgetPolicy?: RuntimeBudgetPolicy;
  metadata?: Record<string, unknown>;
  /** Override env flag for tests only. */
  forceMode?: RuntimeV2Mode;
};

export type RuntimeGenerateTextParams = RuntimeBaseParams & {
  system?: string;
  prompt: string;
  messages?: RuntimeMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  modelId?: string;
};

export type RuntimeGenerateObjectParams<T> = RuntimeBaseParams & {
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  modelId?: string;
  preferJsonMode?: boolean;
};

export type RuntimeEmbedParams = RuntimeBaseParams & {
  texts: string[];
  modelId?: string;
};

export type RuntimeEmbedResult = {
  embeddings: number[][];
  usage: RuntimeUsage;
  workMinutesEstimated?: number;
  finishReason?: string;
  shadow?: boolean;
  routing?: CapabilityRouteDecision;
};

export type RuntimeUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  modelCostUsd: number;
  toolCostUsd: number;
  totalCostUsd: number;
  latencyMs: number;
  providerRoute: ProviderRoute;
  providerName: string;
  modelId: string;
};

export type RuntimeResult<T = unknown> = {
  text?: string;
  object?: T;
  usage: RuntimeUsage;
  workMinutesEstimated?: number;
  finishReason?: string;
  error?: string;
  /** True when AI_RUNTIME_V2_MODE=shadow — no provider call was made. */
  shadow?: boolean;
  /** Planned route from capability router (always populated when runtime invoked). */
  routing?: CapabilityRouteDecision;
};

export type CapabilityRouteInput = {
  workspaceId?: string;
  employeeId?: string;
  capability: AiCapability;
  taskType?: string;
  message?: string;
  contextSize?: number;
  needsTools?: boolean;
  needsReasoning?: boolean;
  needsLongContext?: boolean;
  needsCode?: boolean;
  needsBrowser?: boolean;
  needsArtifact?: boolean;
  riskLevel?: "low" | "medium" | "high";
  userPlan?: string;
  remainingWorkMinutes?: number;
  speedPreference?: "fastest" | "balanced" | "quality";
  qualityPreference?: "efficient" | "balanced" | "premium";
  modelMode?: ModelMode;
  runtimeMode?: RuntimeMode;
  /** V20.0.1b+ — browser research provider (mock, Tavily, Browserbase). */
  researchProvider?: "mock" | "tavily" | "browserbase";
};

export type CapabilityRouteDecision = {
  providerRoute: ProviderRoute;
  providerName: string;
  modelId: string;
  runtimeMode: RuntimeMode;
  capability: AiCapability;
  reasoningProfile: ReasoningProfile;
  estimatedCostUsd: number;
  estimatedWorkMinutes: number;
  fallbackCandidates: Array<{ providerRoute: ProviderRoute; modelId: string }>;
};

export class RuntimeDisabledError extends Error {
  constructor(message = "AI Runtime V2 is disabled (AI_RUNTIME_V2_MODE=off).") {
    super(message);
    this.name = "RuntimeDisabledError";
  }
}
