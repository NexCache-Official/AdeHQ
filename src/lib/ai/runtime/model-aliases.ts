/** Normalize provider-specific model IDs to a shared family key for cross-provider comparison. */
export function normalizeModelFamily(modelId: string): string {
  const raw = modelId.trim().toLowerCase();
  const withoutProvider = raw.includes("/") ? raw.split("/").slice(1).join("/") : raw;

  const aliases: Record<string, string> = {
    "deepseek-ai/deepseek-v3": "deepseek-v3",
    "deepseek/deepseek-v3": "deepseek-v3",
    "deepseek-ai/deepseek-v4-flash": "deepseek-v4-flash",
    "deepseek/deepseek-v4-flash": "deepseek-v4-flash",
    "deepseek-ai/deepseek-v4-pro": "deepseek-v4-pro",
    "deepseek/deepseek-v4-pro": "deepseek-v4-pro",
    "minimaxai/minimax-m2.5": "minimax-m2-5",
    "minimax/minimax-m2.5": "minimax-m2-5",
    "qwen/qwen3-coder-30b-a3b-instruct": "qwen3-coder-30b-a3b",
    "baai/bge-large-en-v1.5": "bge-large-en-v1-5",
    "openai/gpt-4o-mini": "gpt-4o-mini",
    "anthropic/claude-sonnet-4": "claude-sonnet-4",
    "google/gemini-2.5-flash": "gemini-2-5-flash",
    "openai/text-embedding-3-small": "text-embedding-3-small",
    "mock-efficient": "mock-efficient",
    "mock-balanced": "mock-balanced",
  };

  if (aliases[raw]) return aliases[raw]!;

  return withoutProvider
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export const MODEL_FAMILY_ALIASES: Record<string, string[]> = {
  "deepseek-v3": ["deepseek-ai/DeepSeek-V3", "deepseek/deepseek-v3"],
  "deepseek-v4-flash": ["deepseek-ai/DeepSeek-V4-Flash", "deepseek/deepseek-v4-flash"],
  "deepseek-v4-pro": ["deepseek-ai/DeepSeek-V4-Pro", "deepseek/deepseek-v4-pro"],
  "minimax-m2-5": ["MiniMaxAI/MiniMax-M2.5", "minimax/minimax-m2.5"],
  "qwen3-coder-30b-a3b": ["Qwen/Qwen3-Coder-30B-A3B-Instruct"],
  "bge-large-en-v1-5": ["BAAI/bge-large-en-v1.5"],
  "gpt-4o-mini": ["openai/gpt-4o-mini"],
  "claude-sonnet-4": ["anthropic/claude-sonnet-4"],
  "gemini-2-5-flash": ["google/gemini-2.5-flash"],
  "text-embedding-3-small": ["openai/text-embedding-3-small"],
};

export function modelIdsForFamily(family: string): string[] {
  return MODEL_FAMILY_ALIASES[family] ?? [];
}
