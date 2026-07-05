import type {
  BrowserResearchFinding,
  BrowserResearchMockSource,
  BrowserResearchPlannedStep,
  BrowserResearchProvider,
  BrowserResearchRun,
  BrowserResearchRunStatus,
} from "./types";

function normalizeProvider(value: unknown): BrowserResearchProvider {
  if (value === "tavily") return "tavily";
  if (value === "browserbase") return "browserbase";
  return "mock";
}

function jsonObject(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fallback;
}

/** Map a Supabase row (snake_case) to BrowserResearchRun — safe for client realtime payloads. */
export function mapBrowserResearchRunRow(row: Record<string, unknown>): BrowserResearchRun {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: row.room_id ? String(row.room_id) : undefined,
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    employeeId: String(row.employee_id),
    createdBy: String(row.created_by),
    query: String(row.query ?? ""),
    status: String(row.status ?? "created") as BrowserResearchRunStatus,
    provider: normalizeProvider(row.provider),
    workUnitId: row.work_unit_id ? String(row.work_unit_id) : undefined,
    plannedSteps: Array.isArray(row.planned_steps)
      ? (row.planned_steps as BrowserResearchPlannedStep[])
      : [],
    mockSources: Array.isArray(row.mock_sources)
      ? (row.mock_sources as BrowserResearchMockSource[])
      : [],
    findings: Array.isArray(row.findings) ? (row.findings as BrowserResearchFinding[]) : [],
    estimatedWorkMinutes:
      row.estimated_work_minutes != null ? Number(row.estimated_work_minutes) : undefined,
    estimatedCostUsd: row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    metadata: jsonObject(row.metadata, {}),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}
