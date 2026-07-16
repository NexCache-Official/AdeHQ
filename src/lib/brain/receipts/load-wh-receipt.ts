import type { SupabaseClient } from "@supabase/supabase-js";
import { displayWorkHours } from "@/lib/billing/costing/work-hours";

export type WhReceiptLine = {
  capability: string | null;
  workType: string | null;
  workHours: number;
  displayWorkHours: number;
  /** Admin-only fields */
  routeId?: string | null;
  pricingSnapshotId?: string | null;
  modelId?: string | null;
};

export type WhReceipt = {
  brainRunId: string | null;
  messageId: string | null;
  totalWorkHours: number;
  displayTotalWorkHours: number;
  lines: WhReceiptLine[];
};

/**
 * Load WH receipt from ledger by brain_run_id or message_id.
 * Members never see model ids — pass includeAdminDetail for Control/admin.
 */
export async function loadWhReceipt(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    brainRunId?: string | null;
    messageId?: string | null;
    includeAdminDetail?: boolean;
  },
): Promise<WhReceipt | null> {
  if (!input.brainRunId && !input.messageId) return null;

  let query = client
    .from("ai_cost_ledger_entries")
    .select(
      "capability, work_type, work_hours_charged, brain_run_id, message_id, pricing_snapshot_id, model_id, metadata",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("billable_to_workspace", true);

  if (input.brainRunId) {
    query = query.eq("brain_run_id", input.brainRunId);
  } else if (input.messageId) {
    query = query.eq("message_id", input.messageId);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return null;

  const lines: WhReceiptLine[] = data.map((row) => {
    const wh = Number(row.work_hours_charged ?? 0);
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const routeId = typeof meta.routeId === "string" ? meta.routeId : null;
    const capabilityRaw = row.capability ? String(row.capability) : null;
    const workTypeRaw = row.work_type ? String(row.work_type) : null;
    // Member-facing labels — never expose provider names (Exa/Perplexity/Tavily).
    const memberCapability =
      capabilityRaw === "search_semantic" ||
      capabilityRaw === "search_fast" ||
      capabilityRaw === "research_planning" ||
      workTypeRaw === "realtime_search"
        ? "Web research"
        : capabilityRaw === "reasoning" ||
            capabilityRaw === "quick_reply" ||
            capabilityRaw === "structured_chat"
          ? "Answer synthesis"
          : capabilityRaw;
    return {
      capability: input.includeAdminDetail ? capabilityRaw : memberCapability,
      workType: workTypeRaw,
      workHours: wh,
      displayWorkHours: displayWorkHours(wh),
      ...(input.includeAdminDetail
        ? {
            routeId,
            pricingSnapshotId: row.pricing_snapshot_id
              ? String(row.pricing_snapshot_id)
              : null,
            modelId: row.model_id ? String(row.model_id) : null,
          }
        : {}),
    };
  });

  const totalWorkHours = lines.reduce((sum, line) => sum + line.workHours, 0);
  return {
    brainRunId: input.brainRunId ?? (data[0]?.brain_run_id ? String(data[0].brain_run_id) : null),
    messageId: input.messageId ?? (data[0]?.message_id ? String(data[0].message_id) : null),
    totalWorkHours,
    displayTotalWorkHours: displayWorkHours(totalWorkHours),
    lines,
  };
}
