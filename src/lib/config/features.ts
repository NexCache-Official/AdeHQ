/** Production demo mode is off unless explicitly enabled at build time. */
export const ENABLE_DEMO_MODE =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true";

/** Live workforce voice calls (transcript, memory, tasks). Off until real audio ships. */
export const WORKFORCE_CALLS_ENABLED =
  process.env.NEXT_PUBLIC_WORKFORCE_CALLS_ENABLED === "true";

/** PR-18.1 Realtime Brain Calls. Public flag reveals UI only; server rechecks. */
export const LIVE_BRAIN_CALLS_ENABLED =
  process.env.NEXT_PUBLIC_ADEHQ_LIVE_CALLS_V1 === "1";

/**
 * Layered employee intelligence pipeline. Enabled by default; set
 * INTELLIGENCE_V1_ENABLED=false to fall back to the legacy research path.
 */
export function isIntelligenceV1Enabled(): boolean {
  return process.env.INTELLIGENCE_V1_ENABLED !== "false";
}

/**
 * Streaming of the employee composer reply (Phase 4). The client opts in per
 * request; this is the server-side kill switch. Any streaming failure falls back
 * to the blocking path, so leaving this on is safe.
 */
export function isEmployeeReplyStreamingEnabled(): boolean {
  return process.env.ADEHQ_STREAM_EMPLOYEE_REPLIES !== "0";
}

export const DEFAULT_SILICONFLOW_MODEL =
  process.env.ADEHQ_SILICONFLOW_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash";

export const SILICONFLOW_MODEL = DEFAULT_SILICONFLOW_MODEL;

/** V4 Flash is cheaper than V3 for output-heavy workloads — use for efficient/balanced. */
export const SILICONFLOW_CHEAP_MODEL_FALLBACK = "deepseek-ai/DeepSeek-V4-Flash";

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

// "BAAI/bge-large-en-v1.5" isn't in SiliconFlow's catalog on this account (404s
// every call, silently breaking file-search RAG and any other embedding
// consumer) — confirmed via GET /v1/models. Qwen3-Embedding-0.6B is available,
// fast, and returns the same 1024 dims EMBEDDING_DIMENSIONS/pgvector expect.
/** English embedding model — OpenAI-compatible /v1/embeddings on SiliconFlow. */
export const DEFAULT_EMBEDDING_MODEL =
  process.env.ADEHQ_EMBEDDING_MODEL ?? "Qwen/Qwen3-Embedding-0.6B";

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
