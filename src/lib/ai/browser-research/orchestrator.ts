import type { SupabaseClient } from "@supabase/supabase-js";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { normalizeIntelligencePolicy } from "@/lib/ai/intelligence-policy";
import {
  assertBrowserResearchAllowed,
  BrowserResearchPermissionError,
} from "./permissions";
import { assertBrowserResearchPlanAccess } from "@/lib/billing/plans/entitlements";
import { runMockBrowserResearchProvider } from "./mock-provider";
import { persistBrowserResearchChatReply } from "./chat-reply";
import { createResearchReportArtifactFromRun } from "./report-artifact";
import {
  getBrowserbaseSessionCostUsd,
  getBrowserResearchMaxPages,
  getTavilySearchCostUsd,
  isBrowserResearchLiveReady,
  resolveBrowserResearchProviderForQuery,
} from "./provider-config";
import type { BrowserResearchProviderResult } from "./provider-result";
import {
  getBrowserResearchRuntimeDispatch,
  observeBrowserResearchRuntimeShadowSafely,
  shouldExecuteBrowserResearchViaRuntime,
} from "./runtime-shadow";
import { estimateTavilyResearchWorkMinutes, runTavilyBrowserResearchProvider } from "./tavily-provider";
import { scheduleBrowserResearchRunExecution, shouldRunBrowserResearchAsync } from "./async-execute";
import {
  BROWSER_RESEARCH_DEFAULT_WORK_MINUTES,
  BROWSER_RESEARCH_QUERY_MAX_LENGTH,
  type BrowserResearchProvider,
  type BrowserResearchRun,
  type BrowserResearchRunStatus,
} from "./types";
import type {
  AIEmployee,
  EmployeeIntelligencePolicy,
  EmployeeRoleKey,
  ModelMode,
  RoomMessage,
} from "@/lib/types";
import {
  cancelAiWorkUnit,
  completeAiWorkUnit,
  createAiWorkUnit,
  failAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import { nowISO, uid } from "@/lib/utils";

type DbRow = Record<string, unknown>;

function isMissingRelationError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: string }).message)
        : String(error ?? "");
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return (
    code === "42P01" ||
    (msg.includes("browser_research_runs") && msg.includes("does not exist")) ||
    msg.includes("Could not find the table")
  );
}

function jsonObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }
  return fallback;
}

function employeeFromRow(row: DbRow): AIEmployee {
  return {
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    roleKey: row.role_key as EmployeeRoleKey,
    provider: row.provider === "mock" ? "mock" : "siliconflow",
    model: String(row.model ?? ""),
    modelMode: row.model_mode as ModelMode | undefined,
    seniority: String(row.seniority ?? ""),
    status: String(row.status ?? "active") as AIEmployee["status"],
    instructions: String(row.instructions ?? ""),
    communicationStyle: String(row.communication_style ?? ""),
    successCriteria: String(row.success_criteria ?? ""),
    tools: [],
    permissions: jsonObject(row.permissions, {} as AIEmployee["permissions"]),
    memoryCount: Number(row.memory_count ?? 0),
    tasksCompleted: Number(row.tasks_completed ?? 0),
    messagesSent: Number(row.messages_sent ?? 0),
    approvalsRequested: Number(row.approvals_requested ?? 0),
    avgResponseTime: String(row.avg_response_time ?? "-"),
    trustScore: Number(row.trust_score ?? 75),
    accent: String(row.accent ?? "#2f6fed"),
    participationStyle: (row.participation_style as AIEmployee["participationStyle"]) ?? "balanced_teammate",
    isSystemEmployee: Boolean(row.is_system_employee),
    systemEmployeeKey: row.system_employee_key ? String(row.system_employee_key) : undefined,
    metadata: jsonObject(row.metadata, {}),
    intelligencePolicy: normalizeIntelligencePolicy(
      row.intelligence_policy
        ? jsonObject<EmployeeIntelligencePolicy>(row.intelligence_policy, {
            defaultMode: "balanced",
            allowedModes: ["efficient", "balanced", "strong"],
            workHourProfile: "moderate",
            browserAccess: "none",
            routingPreference: "auto",
          })
        : undefined,
      {
        modelMode: row.model_mode as ModelMode | undefined,
        roleKey: row.role_key as EmployeeRoleKey,
      },
    ),
    lastActiveAt: String(row.last_active_at ?? row.updated_at ?? nowISO()),
    createdAt: String(row.created_at ?? nowISO()),
  };
}

function normalizeProvider(value: unknown): BrowserResearchProvider {
  if (value === "tavily") return "tavily";
  if (value === "browserbase") return "browserbase";
  return "mock";
}

function runFromRow(row: DbRow): BrowserResearchRun {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: row.room_id ? String(row.room_id) : undefined,
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    employeeId: String(row.employee_id),
    createdBy: String(row.created_by),
    query: String(row.query),
    status: String(row.status) as BrowserResearchRunStatus,
    provider: normalizeProvider(row.provider),
    workUnitId: row.work_unit_id ? String(row.work_unit_id) : undefined,
    plannedSteps: Array.isArray(row.planned_steps) ? (row.planned_steps as BrowserResearchRun["plannedSteps"]) : [],
    mockSources: Array.isArray(row.mock_sources) ? (row.mock_sources as BrowserResearchRun["mockSources"]) : [],
    findings: Array.isArray(row.findings) ? (row.findings as BrowserResearchRun["findings"]) : [],
    estimatedWorkMinutes:
      row.estimated_work_minutes != null ? Number(row.estimated_work_minutes) : undefined,
    estimatedCostUsd: row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    metadata: jsonObject(row.metadata, {}),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? nowISO()),
  };
}

export function newBrowserResearchRunId(): string {
  return uid("br");
}

export async function loadWorkspaceEmployee(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<AIEmployee | null> {
  const { data, error } = await client
    .from("ai_employees")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();

  if (error) throw error;
  return data ? employeeFromRow(data as DbRow) : null;
}

async function patchRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
  patch: DbRow,
): Promise<BrowserResearchRun> {
  const { data, error } = await client
    .from("browser_research_runs")
    .update({ ...patch, updated_at: nowISO() })
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "browser_research_runs table is not available. Apply migration 20260705150000_browser_research_skeleton.sql.",
      );
    }
    throw error;
  }
  if (!data) throw new Error(`Browser research run not found: ${runId}`);
  return runFromRow(data as DbRow);
}

export async function getBrowserResearchRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
): Promise<BrowserResearchRun | null> {
  const { data, error } = await client
    .from("browser_research_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "browser_research_runs table is not available. Apply migration 20260705150000_browser_research_skeleton.sql.",
      );
    }
    throw error;
  }
  return data ? runFromRow(data as DbRow) : null;
}

export async function listBrowserResearchRuns(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    topicId?: string;
    employeeId?: string;
    limit?: number;
  },
): Promise<BrowserResearchRun[]> {
  let query = client
    .from("browser_research_runs")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 20);

  if (params.topicId) query = query.eq("topic_id", params.topicId);
  if (params.employeeId) query = query.eq("employee_id", params.employeeId);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "browser_research_runs table is not available. Apply migration 20260705150000_browser_research_skeleton.sql.",
      );
    }
    throw error;
  }

  return ((data as DbRow[] | null) ?? []).map(runFromRow);
}

export type CreateBrowserResearchRunParams = {
  workspaceId: string;
  roomId?: string;
  topicId?: string;
  employeeId: string;
  createdBy: string;
  query: string;
  runId?: string;
  provider?: BrowserResearchProvider;
  triggerMessageId?: string;
  userQuestion?: string;
  plannerReasoning?: string;
  resolvedFrom?: string;
  agentRunId?: string;
};

export type ExecuteBrowserResearchContext = {
  runId: string;
  workspaceId: string;
  employeeId: string;
  workUnitId?: string;
  roomId?: string;
  topicId?: string;
  createdBy?: string;
  client?: SupabaseClient;
  onLiveSessionReady?: (liveSessionUrl: string) => void | Promise<void>;
};

async function executeBrowserResearchProvider(
  provider: BrowserResearchProvider,
  query: string,
  context?: ExecuteBrowserResearchContext,
): Promise<BrowserResearchProviderResult & { fallbackReason?: string }> {
  if (provider === "browserbase" && isBrowserResearchLiveReady()) {
    try {
      const { runBrowserbaseBrowserResearchProvider } = await import("./browserbase-provider");
      const result = await runBrowserbaseBrowserResearchProvider(query, {
        runId: context?.runId ?? newBrowserResearchRunId(),
        workspaceId: context?.workspaceId,
        roomId: context?.roomId,
        topicId: context?.topicId,
        employeeId: context?.employeeId,
        workUnitId: context?.workUnitId,
        createdByUserId: context?.createdBy,
        client: context?.client,
        onLiveSessionReady: context?.onLiveSessionReady,
      });
      return result;
    } catch (error) {
      console.warn("[AdeHQ browser research] browserbase failed — falling back to Tavily/mock", error);
      recordAiRuntime({
        provider: "browserbase",
        model: "browserbase/session",
        mode: "fallback",
        fallbackReason: "browserbase_run_failed",
        workspaceId: context?.workspaceId,
        employeeId: context?.employeeId,
        agentRunId: context?.workUnitId ?? context?.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (provider === "browserbase" || provider === "tavily") {
    try {
      return await runTavilyBrowserResearchProvider(query, {
        workspaceId: context?.workspaceId,
        client: context?.client,
      });
    } catch (error) {
      console.warn("[AdeHQ browser research] tavily failed — falling back to mock", error);
      recordAiRuntime({
        provider: "tavily",
        model: "tavily/search-api",
        mode: "fallback",
        fallbackReason: "tavily_run_failed",
        workspaceId: context?.workspaceId,
        employeeId: context?.employeeId,
        agentRunId: context?.workUnitId ?? context?.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ...runMockBrowserResearchProvider(query),
    fallbackReason: provider === "mock" ? undefined : "provider_fallback_mock",
  };
}

function estimateWorkMinutesForProvider(provider: BrowserResearchProvider): number {
  if (provider === "browserbase") {
    return estimateTavilyResearchWorkMinutes(
      getBrowserbaseSessionCostUsd(),
      getBrowserResearchMaxPages(),
    );
  }
  if (provider === "tavily") {
    return estimateTavilyResearchWorkMinutes(getTavilySearchCostUsd(), 0);
  }
  return BROWSER_RESEARCH_DEFAULT_WORK_MINUTES;
}

export async function createBrowserResearchRun(
  client: SupabaseClient,
  params: CreateBrowserResearchRunParams,
): Promise<BrowserResearchRun> {
  const query = params.query.trim();
  if (!query) {
    throw new Error("Research query is required.");
  }
  if (query.length > BROWSER_RESEARCH_QUERY_MAX_LENGTH) {
    throw new Error(`Research query must be at most ${BROWSER_RESEARCH_QUERY_MAX_LENGTH} characters.`);
  }

  const employee = await loadWorkspaceEmployee(client, params.workspaceId, params.employeeId);
  if (!employee) {
    throw new Error("Employee not found in this workspace.");
  }
  assertBrowserResearchAllowed(employee);

  const resolved = params.provider
    ? { provider: params.provider }
    : resolveBrowserResearchProviderForQuery(query);
  const provider = resolved.provider;
  const preEstimateMinutes = estimateWorkMinutesForProvider(provider);

  const routing = routeCapability(
    {
      capability: "browser_research",
      workspaceId: params.workspaceId,
      employeeId: params.employeeId,
      message: query,
      needsBrowser: true,
      researchProvider: provider,
    },
    getRuntimeFlags().providerPref,
  );

  const objective =
    provider === "browserbase"
      ? "Browser research live browse (Browserbase)"
      : provider === "tavily"
        ? "Browser research search (Tavily)"
        : "Browser research skeleton (mock)";

  const workUnit = await createAiWorkUnit(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    employeeId: params.employeeId,
    userId: params.createdBy,
    workType: "browser_research",
    capability: "browser_research",
    objective,
    status: "created",
    runtimeMode: routing.runtimeMode,
    reasoningProfile: routing.reasoningProfile,
    providerRoute: routing.providerRoute,
    providerName: provider,
    modelId: routing.modelId,
    estimatedCostUsd:
      provider === "tavily"
        ? getTavilySearchCostUsd()
        : provider === "browserbase"
          ? getBrowserbaseSessionCostUsd()
          : routing.estimatedCostUsd,
    estimatedWorkMinutes: preEstimateMinutes,
    metadata: {
      skeleton: provider === "mock",
      provider,
      liveBrowsing: provider === "browserbase" && isBrowserResearchLiveReady(),
      searchProvider: provider,
    },
  });

  const runId = params.runId ?? newBrowserResearchRunId();
  const payload = {
    id: runId,
    workspace_id: params.workspaceId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    employee_id: params.employeeId,
    created_by: params.createdBy,
    query,
    status: "created",
    provider,
    work_unit_id: workUnit.id,
    planned_steps: [],
    mock_sources: [],
    findings: [],
    estimated_work_minutes: preEstimateMinutes,
    estimated_cost_usd: provider === "tavily" ? getTavilySearchCostUsd() : routing.estimatedCostUsd,
    metadata: {
      skeleton: provider === "mock",
      liveBrowsing: provider === "browserbase" && isBrowserResearchLiveReady(),
      searchProvider: provider,
      providerFallbackReason: "fallbackReason" in resolved ? resolved.fallbackReason : undefined,
      providerRouteReason: "routeReason" in resolved ? resolved.routeReason : undefined,
      triggerMessageId: params.triggerMessageId,
      userQuestion: params.userQuestion ?? params.query,
      resolvedQuery: params.query,
      plannerReasoning: params.plannerReasoning,
      resolvedFrom: params.resolvedFrom,
      agentRunId: params.agentRunId,
      routingPreview: {
        providerRoute: routing.providerRoute,
        runtimeMode: routing.runtimeMode,
        modelId: routing.modelId,
      },
    },
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  const { data, error } = await client
    .from("browser_research_runs")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "browser_research_runs table is not available. Apply migration 20260705150000_browser_research_skeleton.sql.",
      );
    }
    throw error;
  }

  return runFromRow(data as DbRow);
}

export async function runBrowserResearchRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
  options?: { agentRunId?: string },
): Promise<{ run: BrowserResearchRun; chatReply: RoomMessage | null }> {
  const existing = await getBrowserResearchRun(client, workspaceId, runId);
  if (!existing) {
    throw new Error(`Browser research run not found: ${runId}`);
  }
  if (existing.status === "cancelled") {
    throw new Error("This research run was cancelled.");
  }
  if (existing.status === "completed") {
    return { run: existing, chatReply: null };
  }

  const workUnitId = existing.workUnitId;
  if (!workUnitId) {
    throw new Error("Research run is missing a work unit.");
  }

  const provider = existing.provider;

  try {
    await patchRun(client, workspaceId, runId, { status: "planning" });

    const routing = routeCapability(
      {
        capability: "browser_research",
        workspaceId,
        employeeId: existing.employeeId,
        message: existing.query,
        needsBrowser: true,
        researchProvider: provider,
      },
      getRuntimeFlags().providerPref,
    );

    await startAiWorkUnit(client, workspaceId, workUnitId, {
      providerRoute: routing.providerRoute,
      providerName: provider,
      modelId: routing.modelId,
      runtimeMode: routing.runtimeMode,
      reasoningProfile: routing.reasoningProfile,
      metadata: {
        skeleton: provider === "mock",
        phase: `${provider}_execution`,
        provider,
        liveBrowsing: provider === "browserbase" && shouldExecuteBrowserResearchViaRuntime(),
        runtimeDispatch: getBrowserResearchRuntimeDispatch(),
        runtimeExecutionOnPath: shouldExecuteBrowserResearchViaRuntime(),
      },
    });

    await observeBrowserResearchRuntimeShadowSafely({
      client,
      workspaceId,
      roomId: existing.roomId,
      topicId: existing.topicId,
      employeeId: existing.employeeId,
      query: existing.query,
      researchProvider: provider,
      workUnitId,
    });

    await patchRun(client, workspaceId, runId, {
      status: "running",
      started_at: nowISO(),
    });

    const result = await executeBrowserResearchProvider(provider, existing.query, {
      runId,
      workspaceId,
      employeeId: existing.employeeId,
      workUnitId,
      roomId: existing.roomId,
      topicId: existing.topicId,
      createdBy: existing.createdBy,
      client,
      onLiveSessionReady: async (liveSessionUrl) => {
        const current = await getBrowserResearchRun(client, workspaceId, runId);
        await patchRun(client, workspaceId, runId, {
          status: "running",
          started_at: current?.startedAt ?? nowISO(),
          metadata: {
            ...(current?.metadata ?? {}),
            liveSessionUrl,
            liveSessionStartedAt: nowISO(),
            agentRunId: options?.agentRunId ?? current?.metadata?.agentRunId,
          },
        });
      },
    });

    let completedResult = result;
    let reportArtifactId: string | undefined;
    let reportCostUsd = 0;
    let reportWorkMinutes = 0;

    if (
      result.provider === "browserbase" &&
      existing.topicId &&
      existing.roomId
    ) {
      try {
        const report = await createResearchReportArtifactFromRun({
          client,
          run: {
            id: existing.id,
            workspaceId: existing.workspaceId,
            roomId: existing.roomId,
            topicId: existing.topicId,
            employeeId: existing.employeeId,
            createdBy: existing.createdBy,
            query: existing.query,
            findings: result.findings,
            mockSources: result.mockSources,
            workUnitId,
          },
          evidenceIds: result.evidenceIds,
          stagehandLlmProvider: result.stagehandLlmProvider,
          stagehandModelId: result.stagehandModelId,
        });
        if (report) {
          reportArtifactId = report.artifactId;
          reportCostUsd = report.reportCostUsd;
          reportWorkMinutes = report.reportWorkMinutes;
          completedResult = {
            ...result,
            reportArtifactId,
            reportCostUsd,
            estimatedCostUsd: Math.round((result.estimatedCostUsd + reportCostUsd) * 1_000_000) / 1_000_000,
            estimatedWorkMinutes:
              Math.round((result.estimatedWorkMinutes + reportWorkMinutes) * 100) / 100,
          };
        }
      } catch (error) {
        console.warn("[AdeHQ browser research] report artifact failed", error);
      }
    }

    let completionMetadata: Record<string, unknown> = {
      skeleton: completedResult.provider === "mock",
      provider: completedResult.provider,
      liveBrowsing: completedResult.provider === "browserbase",
      sourceCount: completedResult.mockSources.length,
      findingCount: completedResult.findings.length,
      resultCount: completedResult.resultCount,
      providerFallbackReason: completedResult.fallbackReason,
      evidenceIds: completedResult.evidenceIds,
      reportArtifactId,
      reportCostUsd: reportCostUsd || undefined,
      stagehandLlmProvider: completedResult.stagehandLlmProvider,
      stagehandModelId: completedResult.stagehandModelId,
    };

    try {
      const { data: workUnitRow } = await client
        .from("ai_work_units")
        .select("metadata")
        .eq("workspace_id", workspaceId)
        .eq("id", workUnitId)
        .maybeSingle();
      if (workUnitRow?.metadata && typeof workUnitRow.metadata === "object") {
        completionMetadata = {
          ...(workUnitRow.metadata as Record<string, unknown>),
          ...completionMetadata,
        };
      }
    } catch {
      // non-blocking — preserve completion even if metadata read fails
    }

    await completeAiWorkUnit(client, workspaceId, workUnitId, {
      actualCostUsd: completedResult.estimatedCostUsd,
      actualWorkMinutes: completedResult.estimatedWorkMinutes,
      metadata: completionMetadata,
    });

    const completedRun = await patchRun(client, workspaceId, runId, {
      status: "completed",
      provider: completedResult.provider,
      planned_steps: completedResult.plannedSteps,
      mock_sources: completedResult.mockSources,
      findings: completedResult.findings,
      estimated_work_minutes: completedResult.estimatedWorkMinutes,
      estimated_cost_usd: completedResult.estimatedCostUsd,
      metadata: {
        ...existing.metadata,
        ...completionMetadata,
      },
      completed_at: nowISO(),
    });

    let chatReply: RoomMessage | null = null;
    if (existing.roomId && existing.topicId) {
      try {
        const employee = await loadWorkspaceEmployee(client, workspaceId, existing.employeeId);
        if (employee) {
          chatReply = await persistBrowserResearchChatReply(
            client,
            completedRun,
            completedResult,
            employee,
          );
        }
      } catch (error) {
        console.warn("[AdeHQ browser research] chat reply failed", error);
      }
    }

    return { run: completedRun, chatReply };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackMinutes =
      provider === "browserbase"
        ? estimateWorkMinutesForProvider("browserbase")
        : provider === "tavily"
          ? estimateTavilyResearchWorkMinutes(getTavilySearchCostUsd(), 0)
          : BROWSER_RESEARCH_DEFAULT_WORK_MINUTES;
    if (workUnitId) {
      await failAiWorkUnit(client, workspaceId, workUnitId, message, {
        actualWorkMinutes: fallbackMinutes,
        metadata: { skeleton: provider === "mock", failed: true, provider },
      }).catch(() => undefined);
    }
    await patchRun(client, workspaceId, runId, {
      status: "failed",
      error_message: message,
      completed_at: nowISO(),
    }).catch(() => undefined);
    throw error;
  }
}

/** @deprecated Use runBrowserResearchRun — kept for V20.0.0 test compatibility. */
export async function runBrowserResearchMock(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
): Promise<BrowserResearchRun> {
  const { run } = await runBrowserResearchRun(client, workspaceId, runId);
  return run;
}

export async function createAndRunBrowserResearch(
  client: SupabaseClient,
  params: CreateBrowserResearchRunParams,
): Promise<{ run: BrowserResearchRun; chatReply: RoomMessage | null; async: boolean }> {
  // Single enforcement chokepoint: browser research is gated by the workspace's plan.
  await assertBrowserResearchPlanAccess(client, params.workspaceId);
  const created = await createBrowserResearchRun(client, params);
  if (shouldRunBrowserResearchAsync(created.provider)) {
    scheduleBrowserResearchRunExecution({
      runId: created.id,
      workspaceId: params.workspaceId,
      agentRunId: params.agentRunId,
    });
    return { run: created, chatReply: null, async: true };
  }
  const result = await runBrowserResearchRun(client, params.workspaceId, created.id, {
    agentRunId: params.agentRunId,
  });
  return { ...result, async: false };
}

/** @deprecated Use createAndRunBrowserResearch */
export async function createAndRunBrowserResearchMock(
  client: SupabaseClient,
  params: CreateBrowserResearchRunParams,
): Promise<BrowserResearchRun> {
  const { run } = await createAndRunBrowserResearch(client, params);
  return run;
}

export async function cancelBrowserResearchRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
  reason?: string,
): Promise<BrowserResearchRun> {
  const existing = await getBrowserResearchRun(client, workspaceId, runId);
  if (!existing) {
    throw new Error(`Browser research run not found: ${runId}`);
  }

  if (existing.status === "completed" || existing.status === "failed") {
    return existing;
  }

  await import("./browserbase-provider").then(({ closeBrowserbaseSessionForRun }) =>
    closeBrowserbaseSessionForRun(runId),
  );

  if (existing.workUnitId) {
    await cancelAiWorkUnit(
      client,
      workspaceId,
      existing.workUnitId,
      reason ?? "Browser research run cancelled.",
    ).catch(() => undefined);
  }

  return patchRun(client, workspaceId, runId, {
    status: "cancelled",
    error_message: reason ?? "Cancelled by user.",
    completed_at: nowISO(),
  });
}
