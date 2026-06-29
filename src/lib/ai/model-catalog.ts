import type { EmployeeRoleKey } from "@/lib/types";
import {
  DEFAULT_SILICONFLOW_MODEL,
  SILICONFLOW_CHEAP_MODEL,
  SILICONFLOW_CODER_MODEL,
  SILICONFLOW_LONG_CONTEXT_MODEL,
  SILICONFLOW_STRONG_MODEL,
} from "@/lib/config/features";

export type ModelMode =
  | "cheap"
  | "balanced"
  | "strong"
  | "long_context"
  | "coding"
  | "creative";

export const MODEL_MODES: ModelMode[] = [
  "cheap",
  "balanced",
  "strong",
  "long_context",
  "coding",
  "creative",
];

export const ROLE_DEFAULT_MODE: Record<EmployeeRoleKey, ModelMode> = {
  research: "long_context",
  pm: "balanced",
  operations: "balanced",
  sales: "balanced",
  marketing: "balanced",
  design: "balanced",
  engineering: "coding",
  gamedev: "coding",
  support: "cheap",
};

const OUTPUT_TOKEN_CAPS: Record<ModelMode, number> = {
  cheap: 800,
  balanced: 2000,
  strong: 2000,
  long_context: 5000,
  coding: 4000,
  creative: 2000,
};

const TIMEOUT_MS: Record<ModelMode, number> = {
  cheap: 30_000,
  balanced: 45_000,
  strong: 60_000,
  long_context: 90_000,
  coding: 90_000,
  creative: 45_000,
};

/** Rough per-1M-token pricing (USD) for cost estimates. */
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  [SILICONFLOW_CHEAP_MODEL]: { input: 0.1, output: 0.15 },
  "deepseek-ai/DeepSeek-V3": { input: 0.14, output: 0.28 },
  "Qwen/Qwen3-Coder-30B-A3B-Instruct": { input: 0.3, output: 0.6 },
  "MiniMaxAI/MiniMax-M2.5": { input: 0.4, output: 0.8 },
  [DEFAULT_SILICONFLOW_MODEL]: { input: 0.3, output: 0.6 },
  [SILICONFLOW_STRONG_MODEL]: { input: 0.8, output: 1.6 },
  [SILICONFLOW_CODER_MODEL]: { input: 0.5, output: 1.0 },
  [SILICONFLOW_LONG_CONTEXT_MODEL]: { input: 0.4, output: 0.8 },
};

const DEFAULT_PRICING = { input: 0.5, output: 1.0 };

export function defaultModelModeForRole(roleKey: EmployeeRoleKey): ModelMode {
  return ROLE_DEFAULT_MODE[roleKey] ?? "balanced";
}

export function normalizeModelMode(value?: string | null): ModelMode {
  const mode = (value ?? "balanced").toLowerCase() as ModelMode;
  if (MODEL_MODES.includes(mode) && mode !== "creative") return mode;
  return "balanced";
}

export function resolveModel(
  provider: string,
  modelMode: ModelMode,
  explicitModel?: string | null,
): string {
  if (explicitModel?.trim()) return explicitModel.trim();

  switch (modelMode) {
    case "cheap":
      return SILICONFLOW_CHEAP_MODEL;
    case "strong":
      return SILICONFLOW_STRONG_MODEL;
    case "long_context":
      return SILICONFLOW_LONG_CONTEXT_MODEL;
    case "coding":
      return SILICONFLOW_CODER_MODEL;
    case "creative":
      return DEFAULT_SILICONFLOW_MODEL;
    case "balanced":
    default:
      return DEFAULT_SILICONFLOW_MODEL;
  }
}

export function getOutputTokenCap(mode: ModelMode): number {
  return OUTPUT_TOKEN_CAPS[mode] ?? OUTPUT_TOKEN_CAPS.balanced;
}

export function getTimeoutMs(mode: ModelMode): number {
  return TIMEOUT_MS[mode] ?? TIMEOUT_MS.balanced;
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = PRICING_PER_MILLION[model] ?? DEFAULT_PRICING;
  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output
  );
}

export function estimateCostForRun(
  model: string,
  promptLength: number,
  maxOutputTokens: number,
): { inputTokens: number; outputTokens: number; cost: number } {
  const inputTokens = Math.max(50, Math.ceil(promptLength / 4));
  const outputTokens = maxOutputTokens;
  return {
    inputTokens,
    outputTokens,
    cost: estimateCost(model, inputTokens, outputTokens),
  };
}

export const MODEL_MODE_LABELS: Record<ModelMode, string> = {
  cheap: "Fast & economical",
  balanced: "Balanced",
  strong: "Strong reasoning",
  long_context: "Long context",
  coding: "Coding",
  creative: "Creative (coming soon)",
};
