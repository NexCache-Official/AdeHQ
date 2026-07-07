import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InvestorContact,
  InvestorFirm,
  InvestorPipelineRecord,
  InvestorsListPayload,
  InvestorsSummary,
  InvestorStage,
} from "@/lib/investors/types";

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

function mapFirm(row: DbRow): InvestorFirm {
  return {
    id: String(row.id),
    name: String(row.name),
    website: row.website ? String(row.website) : null,
    focus: row.focus ? String(row.focus) : null,
    stageFocus: row.stage_focus ? String(row.stage_focus) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

function mapContact(row: DbRow): InvestorContact {
  return {
    id: String(row.id),
    firmId: row.firm_id ? String(row.firm_id) : null,
    fullName: String(row.full_name ?? ""),
    title: row.title ? String(row.title) : null,
    email: row.email ? String(row.email) : null,
    linkedinUrl: row.linkedin_url ? String(row.linkedin_url) : null,
    notes: row.notes ? String(row.notes) : null,
    ownerEmployeeId: row.owner_employee_id ? String(row.owner_employee_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

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

function buildSummary(
  firms: InvestorFirm[],
  contacts: InvestorContact[],
  pipeline: InvestorPipelineRecord[],
): InvestorsSummary {
  const active = pipeline.filter((p) => p.stage !== "passed" && p.stage !== "committed");
  const scored = pipeline.filter((p) => p.fitScore != null).map((p) => Number(p.fitScore));
  const averageFitScore =
    scored.length > 0 ? Number((scored.reduce((sum, score) => sum + score, 0) / scored.length).toFixed(1)) : null;

  return {
    firmCount: firms.length,
    contactCount: contacts.length,
    pipelineCount: pipeline.length,
    activePipelineCount: active.length,
    averageFitScore,
  };
}

export async function listInvestorsWorkspaceData(
  client: SupabaseClient,
  workspaceId: string,
  options?: { query?: string; limit?: number },
): Promise<InvestorsListPayload> {
  const limit = options?.limit ?? 200;
  const query = options?.query?.trim();

  let firmsQuery = client
    .from("investor_firms")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (query) {
    const q = `%${query}%`;
    firmsQuery = firmsQuery.or(`name.ilike.${q},website.ilike.${q},focus.ilike.${q},stage_focus.ilike.${q}`);
  }

  let contactsQuery = client
    .from("investor_contacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (query) {
    const q = `%${query}%`;
    contactsQuery = contactsQuery.or(`full_name.ilike.${q},email.ilike.${q},title.ilike.${q}`);
  }

  let pipelineQuery = client
    .from("investor_pipeline")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (query) {
    const q = `%${query}%`;
    pipelineQuery = pipelineQuery.or(`stage.ilike.${q},notes.ilike.${q}`);
  }

  const [firmsRes, contactsRes, pipelineRes] = await Promise.all([
    firmsQuery,
    contactsQuery,
    pipelineQuery,
  ]);

  if (firmsRes.error) throw firmsRes.error;
  if (contactsRes.error) throw contactsRes.error;
  if (pipelineRes.error) throw pipelineRes.error;

  const firms = (firmsRes.data ?? []).map((row) => mapFirm(row as DbRow));
  const contacts = (contactsRes.data ?? []).map((row) => mapContact(row as DbRow));
  const pipeline = (pipelineRes.data ?? []).map((row) => mapPipelineRecord(row as DbRow));

  return {
    firms,
    contacts,
    pipeline,
    stages: INVESTOR_STAGES,
    summary: buildSummary(firms, contacts, pipeline),
  };
}
