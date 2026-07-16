import type { ModelMode } from "@/lib/ai/model-catalog";

/** @deprecated Member UI uses Auto — keep for kill-switch / admin diagnostics only. */
export const INTELLIGENCE_MODE_LABELS: Record<ModelMode, string> = {
  cheap: "Auto",
  balanced: "Auto",
  strong: "Auto",
  long_context: "Auto",
  coding: "Auto",
  creative: "Auto",
};

/** @deprecated Member UI uses Auto — keep for kill-switch / admin diagnostics only. */
export const RUNTIME_MODE_LABELS: Record<ModelMode, string> = {
  cheap: "Auto",
  balanced: "Auto",
  strong: "Auto",
  long_context: "Auto",
  coding: "Auto",
  creative: "Auto",
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

/** @deprecated Not shown in member hire UI under Brain Auto. */
export function commonModelFamiliesLabel(_mode: ModelMode): string {
  return "AdeHQ Auto";
}

export function defaultIntelligenceShort(_mode: ModelMode): string {
  return "Auto";
}
