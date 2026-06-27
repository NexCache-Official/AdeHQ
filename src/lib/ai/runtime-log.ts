export type AiRuntimeLogEntry = {
  id: string;
  at: string;
  workspaceId?: string;
  roomId?: string;
  employeeId?: string;
  provider: string;
  model: string;
  mode: "live" | "fallback" | "mock";
  fallbackReason?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
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
    mode: row.mode,
    workspaceId: row.workspaceId,
    roomId: row.roomId,
    employeeId: row.employeeId,
    fallbackReason: row.fallbackReason,
    error: row.error,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  });
}

export function getAiRuntimeSnapshot() {
  return {
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    defaultModel: process.env.ADEHQ_OPENAI_MODEL ?? "gpt-5.4-mini",
    environment: process.env.NODE_ENV ?? "development",
    demoModeEnabled: process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true",
    last: lastEntry,
    recent: entries.slice(0, 12),
  };
}
