import type { ModelMode } from "@/lib/ai/model-catalog";

export const INTELLIGENCE_MODE_LABELS: Record<ModelMode, string> = {
  cheap: "Efficient Intelligence",
  balanced: "Balanced Intelligence",
  strong: "Strong Intelligence",
  long_context: "Long Context Intelligence",
  coding: "Coding Intelligence",
  creative: "Balanced Intelligence",
};

export const RUNTIME_MODE_LABELS: Record<ModelMode, string> = {
  cheap: "Efficient",
  balanced: "Balanced",
  strong: "Strong",
  long_context: "Long context",
  coding: "Coding",
  creative: "Creative",
};

export const CONTEXT_PROFILE_LABELS: Record<ModelMode, string> = {
  cheap: "Lightweight",
  balanced: "Standard",
  strong: "Deep reasoning",
  long_context: "Extended",
  coding: "Standard",
  creative: "Standard",
};

/** User-facing engine model name — no provider branding. */
export function displayEngineModel(modelId: string): string {
  const slug = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  return slug;
}

/** Friendly model families — no provider branding or raw IDs in customer UI. */
export function commonModelFamiliesLabel(mode: ModelMode): string {
  switch (mode) {
    case "cheap":
      return "DeepSeek, Qwen";
    case "coding":
      return "Qwen Coder, DeepSeek";
    case "strong":
      return "DeepSeek, Qwen";
    case "long_context":
      return "DeepSeek, Qwen";
    default:
      return "DeepSeek, Qwen Coder";
  }
}

export function defaultIntelligenceShort(mode: ModelMode): string {
  return RUNTIME_MODE_LABELS[mode] ?? "Balanced";
}
