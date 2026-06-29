import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_SILICONFLOW_MODEL,
  isOpenAiConfigured,
  isSiliconFlowConfigured,
} from "@/lib/config/features";

export type AiRuntimeLogEntry = {
  id: string;
  at: string;
  workspaceId?: string;
  roomId?: string;
  employeeId?: string;
  provider: string;
  model: string;
  modelMode?: string;
  mode: "live" | "fallback" | "mock" | "blocked";
  fallbackReason?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  agentRunId?: string;
  fallbackTier?: number;
};

const MAX_ENTRIES = 40;
const entries: AiRuntimeLogEntry[] = [];
let lastEntry: AiRuntimeLogEntry | null = null;

function uid() {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recordAiRuntime(entry: Omit<AiRuntimeLogEntry, "id" | "at">) {
  const row: AiRuntimeLogEntry = {
    id: uid(),
    at: new Date().toISOString(),
    ...entry,
  };
  entries.unshift(row);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  lastEntry = row;

  console.info("[AdeHQ AI runtime]", {
    provider: row.provider,
    model: row.model,
    modelMode: row.modelMode,
    mode: row.mode,
    workspaceId: row.workspaceId,
    roomId: row.roomId,
    employeeId: row.employeeId,
    agentRunId: row.agentRunId,
    fallbackReason: row.fallbackReason,
    error: row.error,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedTokens: row.cachedTokens,
    estimatedCostUsd: row.estimatedCostUsd,
    fallbackTier: row.fallbackTier,
  });
}

export function getAiRuntimeSnapshot() {
  return {
    siliconflowConfigured: isSiliconFlowConfigured(),
    openAiConfigured: isOpenAiConfigured(),
    defaultProvider: DEFAULT_PROVIDER,
    defaultSiliconflowModel: DEFAULT_SILICONFLOW_MODEL,
    defaultModel: DEFAULT_OPENAI_MODEL,
    environment: process.env.NODE_ENV ?? "development",
    demoModeEnabled: process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true",
    last: lastEntry,
    recent: entries.slice(0, 12),
  };
}
