import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCostToPeriod } from "@/lib/billing/usage/periods";
import type { CostEventInput, CostLedgerEntry } from "./types";
import { getWorkHourUsdRate, workHoursFromCost } from "./work-hours";

function isMissingTableError(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return code === "42P01" || (msg.includes("ai_cost_ledger_entries") && msg.includes("does not exist"));
}

function isDuplicateError(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return code === "23505";
}

function resolveCostUsd(input: CostEventInput): { actual: number; estimated: number } {
  const actual = input.actualCostUsd != null && input.actualCostUsd > 0 ? input.actualCostUsd : 0;
  const estimated =
    input.estimatedCostUsd != null && input.estimatedCostUsd > 0 ? input.estimatedCostUsd : 0;
  return { actual, estimated };
}

/**
 * Single write path for billable AI cost events.
 * Inserts one row into ai_cost_ledger_entries and computes Work Hours from the billable cost.
 * Platform-overhead events (internal orchestration) are recorded but not billed to the workspace.
 * Idempotent per (work_unit_id, source_type).
 */
export async function recordCostEvent(
  client: SupabaseClient,
  input: CostEventInput,
): Promise<CostLedgerEntry | null> {
  const { actual, estimated } = resolveCostUsd(input);
  const billableToWorkspace =
    input.billableToWorkspace ?? !(input.platformOverhead ?? false);
  const platformOverhead = input.platformOverhead ?? false;

  const rate = getWorkHourUsdRate();
  // Bill Work Hours only for workspace-billable events using the best-known cost.
  const costForHours = actual > 0 ? actual : estimated;
  const workHoursCharged = billableToWorkspace ? workHoursFromCost(costForHours, rate) : 0;

  const totalTokens =
    input.totalTokens && input.totalTokens > 0
      ? input.totalTokens
      : (input.inputTokens ?? 0) + (input.outputTokens ?? 0);

  const payload = {
    workspace_id: input.workspaceId,
    user_id: input.userId ?? null,
    employee_id: input.employeeId ?? null,
    work_unit_id: input.workUnitId ?? null,
    room_id: input.roomId ?? null,
    topic_id: input.topicId ?? null,
    message_id: input.messageId ?? null,
    source_type: input.sourceType,
    provider_route: input.providerRoute ?? null,
    provider_name: input.providerName ?? null,
    model_id: input.modelId ?? null,
    endpoint_key: input.endpointKey ?? null,
    runtime_mode: input.runtimeMode ?? null,
    capability: input.capability ?? null,
    work_type: input.workType ?? input.sourceType,
    input_tokens: input.inputTokens ?? 0,
    cached_input_tokens: input.cachedInputTokens ?? 0,
    output_tokens: input.outputTokens ?? 0,
    total_tokens: totalTokens,
    search_requests: input.searchRequests ?? 0,
    search_credits: input.searchCredits ?? 0,
    browser_session_seconds: input.browserSessionSeconds ?? 0,
    browser_pages_opened: input.browserPagesOpened ?? 0,
    browser_screenshots: input.browserScreenshots ?? 0,
    unit_cost_usd: input.unitCostUsd ?? null,
    estimated_cost_usd: estimated,
    actual_cost_usd: actual,
    cost_source: input.costSource ?? (actual > 0 ? "provider_usage" : "estimated"),
    billable_to_workspace: billableToWorkspace,
    platform_overhead: platformOverhead,
    work_hour_usd_rate: rate,
    work_hours_charged: workHoursCharged,
    status: input.status ?? "succeeded",
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await client
    .from("ai_cost_ledger_entries")
    .insert(payload)
    .select("id, workspace_id, employee_id, source_type, actual_cost_usd, work_hours_charged, billable_to_workspace, platform_overhead, created_at")
    .single();

  if (error) {
    if (isDuplicateError(error)) return null;
    if (isMissingTableError(error)) {
      throw new Error(
        "ai_cost_ledger_entries table is not available. Apply migration 20260706210000_commercial_usage_ledger.sql.",
      );
    }
    throw error;
  }

  const entry: CostLedgerEntry = {
    id: String(data.id),
    workspaceId: String(data.workspace_id),
    employeeId: data.employee_id ? String(data.employee_id) : null,
    sourceType: data.source_type,
    actualCostUsd: Number(data.actual_cost_usd ?? 0),
    workHoursCharged: Number(data.work_hours_charged ?? 0),
    billableToWorkspace: Boolean(data.billable_to_workspace),
    platformOverhead: Boolean(data.platform_overhead),
    createdAt: String(data.created_at),
  };

  // Roll billable Work Hours into the current weekly period.
  if (entry.billableToWorkspace && (entry.workHoursCharged > 0 || entry.actualCostUsd > 0)) {
    try {
      await applyCostToPeriod(client, entry.workspaceId, entry.workHoursCharged, entry.actualCostUsd);
    } catch (error) {
      console.warn("[AdeHQ usage period]", error);
    }
  }

  return entry;
}
