import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvestorPipelineRecord, InvestorStage } from "@/lib/investors/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

const INVESTOR_STAGES: InvestorStage[] = [
  "target",
  "researched",
  "drafted",
  "contacted",
  "replied",
  "meeting",
  "passed",
  "committed",
];

function mapPipelineRecord(row: DbRow): InvestorPipelineRecord {
  const stage = String(row.stage ?? "target").toLowerCase();
  return {
    id: String(row.id),
    firmId: row.firm_id ? String(row.firm_id) : null,
    contactId: row.contact_id ? String(row.contact_id) : null,
    stage: (INVESTOR_STAGES.includes(stage as InvestorStage) ? stage : "target") as InvestorStage,
    fitScore: row.fit_score != null ? Number(row.fit_score) : null,
    targetAmount: row.target_amount != null ? Number(row.target_amount) : null,
    currency: String(row.currency ?? "GBP"),
    notes: row.notes ? String(row.notes) : null,
    nextFollowUpAt: row.next_follow_up_at ? String(row.next_follow_up_at) : null,
    ownerEmployeeId: row.owner_employee_id ? String(row.owner_employee_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

export async function updateInvestorPipelineRecord(
  client: SupabaseClient,
  workspaceId: string,
  pipelineId: string,
  patch: {
    stage?: InvestorStage;
    fitScore?: number | null;
    targetAmount?: number | null;
    currency?: string;
    notes?: string | null;
    nextFollowUpAt?: string | null;
  },
): Promise<InvestorPipelineRecord> {
  const { data: existing, error: loadError } = await client
    .from("investor_pipeline")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", pipelineId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("Pipeline record not found.");

  const update: DbRow = { updated_at: nowISO() };
  if (patch.stage !== undefined) {
    if (!INVESTOR_STAGES.includes(patch.stage)) {
      throw new Error(`Unknown stage "${patch.stage}".`);
    }
    update.stage = patch.stage;
  }
  if (patch.fitScore !== undefined) update.fit_score = patch.fitScore;
  if (patch.targetAmount !== undefined) update.target_amount = patch.targetAmount;
  if (patch.currency !== undefined) update.currency = patch.currency.trim().toUpperCase();
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.nextFollowUpAt !== undefined) update.next_follow_up_at = patch.nextFollowUpAt;

  const { error } = await client
    .from("investor_pipeline")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", pipelineId);
  if (error) throw error;

  const { data: updated, error: reloadError } = await client
    .from("investor_pipeline")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", pipelineId)
    .maybeSingle();
  if (reloadError) throw reloadError;
  if (!updated) throw new Error("Pipeline update failed.");

  return mapPipelineRecord(updated as DbRow);
}
