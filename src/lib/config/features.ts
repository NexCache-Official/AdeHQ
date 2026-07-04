/** Production demo mode is off unless explicitly enabled at build time. */
export const ENABLE_DEMO_MODE =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true";

export const DEFAULT_SILICONFLOW_MODEL =
  process.env.ADEHQ_SILICONFLOW_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash";

export const SILICONFLOW_MODEL = DEFAULT_SILICONFLOW_MODEL;

/** Verified on SiliconFlow API — reliable, low cost, no reasoning-token burn. */
export const SILICONFLOW_CHEAP_MODEL_FALLBACK = "deepseek-ai/DeepSeek-V3";

export const SILICONFLOW_CHEAP_MODEL =
  process.env.ADEHQ_SILICONFLOW_CHEAP_MODEL ?? SILICONFLOW_CHEAP_MODEL_FALLBACK;

export const SILICONFLOW_API_BASE_URL =
  process.env.SILICONFLOW_API_BASE_URL ?? "https://api.siliconflow.com/v1";

export const SILICONFLOW_CODER_MODEL =
  process.env.ADEHQ_SILICONFLOW_CODER_MODEL ?? "Qwen/Qwen3-Coder-30B-A3B-Instruct";

export const SILICONFLOW_LONG_CONTEXT_MODEL =
  process.env.ADEHQ_SILICONFLOW_LONG_CONTEXT_MODEL ?? "MiniMaxAI/MiniMax-M2.5";

export const SILICONFLOW_STRONG_MODEL =
  process.env.ADEHQ_SILICONFLOW_STRONG_MODEL ?? "deepseek-ai/DeepSeek-V4-Pro";

/** English embedding model — OpenAI-compatible /v1/embeddings on SiliconFlow. */
export const DEFAULT_EMBEDDING_MODEL =
  process.env.ADEHQ_EMBEDDING_MODEL ?? "BAAI/bge-large-en-v1.5";

export const EMBEDDING_DIMENSIONS = 1024;

export const DEFAULT_PROVIDER =
  (process.env.ADEHQ_DEFAULT_PROVIDER ?? "siliconflow").toLowerCase();

export function isSiliconFlowConfigured(): boolean {
  return Boolean(process.env.SILICONFLOW_API_KEY?.trim());
}

export type LiveProvider = "siliconflow" | "mock";

/** Map legacy provider values (e.g. openai) to the live SiliconFlow runtime. */
export function normalizeLiveProvider(raw?: string | null): LiveProvider {
  const value = (raw ?? "siliconflow").toLowerCase();
  if (value === "mock") return "mock";
  return "siliconflow";
}
