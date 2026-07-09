import type { AiCapability, RuntimeMode } from "../types";

/** Gateway defaults mirror SiliconFlow families (DeepSeek / MiniMax / Qwen) — override via AI_GATEWAY_MODEL_* env vars. */
export const VERCEL_GATEWAY_DEFAULT_MODELS = {
  efficient: "deepseek/deepseek-v4-flash",
  balanced: "deepseek/deepseek-v4-flash",
  strong: "deepseek/deepseek-v4-pro",
  long_context: "minimax/minimax-m2.5",
  coding: "qwen/qwen3-coder-30b-a3b-instruct",
  embedding: "openai/text-embedding-3-small",
} as const;

export type VercelGatewayModelSlot = keyof typeof VERCEL_GATEWAY_DEFAULT_MODELS;

const ENV_BY_SLOT: Record<VercelGatewayModelSlot, string> = {
  efficient: "AI_GATEWAY_MODEL_EFFICIENT",
  balanced: "AI_GATEWAY_MODEL_BALANCED",
  strong: "AI_GATEWAY_MODEL_STRONG",
  long_context: "AI_GATEWAY_MODEL_LONG_CONTEXT",
  coding: "AI_GATEWAY_MODEL_CODING",
  embedding: "AI_GATEWAY_MODEL_EMBEDDING",
};

function envOverride(slot: VercelGatewayModelSlot): string | undefined {
  const value = process.env[ENV_BY_SLOT[slot]]?.trim();
  return value || undefined;
}

export function isVercelGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

function slotForRuntimeMode(runtimeMode: RuntimeMode): VercelGatewayModelSlot {
  switch (runtimeMode) {
    case "efficient":
      return "efficient";
    case "strong":
    case "research":
      return "strong";
    case "long_context":
      return "long_context";
    case "coding":
      return "coding";
    case "embedding":
      return "embedding";
    case "balanced":
    default:
      return "balanced";
  }
}

/** Resolve a Gateway model ID from runtime mode, capability, or explicit override. */
export function resolveVercelGatewayModelId(params: {
  runtimeMode: RuntimeMode;
  capability?: AiCapability;
  modelId?: string;
}): string {
  if (params.modelId?.trim()) return params.modelId.trim();
  if (params.capability === "embedding" || params.runtimeMode === "embedding") {
    return envOverride("embedding") ?? VERCEL_GATEWAY_DEFAULT_MODELS.embedding;
  }
  const slot = slotForRuntimeMode(params.runtimeMode);
  return envOverride(slot) ?? VERCEL_GATEWAY_DEFAULT_MODELS[slot];
}

export function listVercelGatewayModelMappings(): Array<{
  slot: VercelGatewayModelSlot;
  envVar: string;
  defaultModelId: string;
  resolvedModelId: string;
}> {
  return (Object.keys(VERCEL_GATEWAY_DEFAULT_MODELS) as VercelGatewayModelSlot[]).map(
    (slot) => ({
      slot,
      envVar: ENV_BY_SLOT[slot],
      defaultModelId: VERCEL_GATEWAY_DEFAULT_MODELS[slot],
      resolvedModelId: envOverride(slot) ?? VERCEL_GATEWAY_DEFAULT_MODELS[slot],
    }),
  );
}
