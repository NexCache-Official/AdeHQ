import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePipelineStages } from "@/lib/integrations/adapters/adehq-crm";
import type {
  CrmCompany,
  CrmContact,
  CrmDeal,
  CrmListPayload,
  CrmPipelineStage,
  CrmSummary,
} from "@/lib/crm/types";

type DbRow = Record<string, unknown>;

function mapContact(row: DbRow): CrmContact {
  return {
    id: String(row.id),
    firstName: String(row.first_name ?? ""),
    lastName: row.last_name ? String(row.last_name) : null,
    fullName: String(row.full_name ?? ""),
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    title: row.title ? String(row.title) : null,
    companyId: row.company_id ? String(row.company_id) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    notes: row.notes ? String(row.notes) : null,
    source: row.source ? String(row.source) : null,
    ownerEmployeeId: row.owner_employee_id ? String(row.owner_employee_id) : null,
    createdAt: String(row.created_at),
  };
}

function mapCompany(row: DbRow): CrmCompany {
  return {
    id: String(row.id),
    name: String(row.name),
    domain: row.domain ? String(row.domain) : null,
    industry: row.industry ? String(row.industry) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
  };
}

function mapDeal(row: DbRow): CrmDeal {
  return {
    id: String(row.id),
    name: String(row.name),
    amount: row.amount != null ? Number(row.amount) : null,
    currency: String(row.currency ?? "USD"),
    stageId: row.stage_id ? String(row.stage_id) : null,
    stageName: String(row.stage_name ?? "Lead"),
    status: (row.status as CrmDeal["status"]) ?? "open",
    contactId: row.contact_id ? String(row.contact_id) : null,
    companyId: row.company_id ? String(row.company_id) : null,
    expectedCloseDate: row.expected_close_date ? String(row.expected_close_date) : null,
    notes: row.notes ? String(row.notes) : null,
    ownerEmployeeId: row.owner_employee_id ? String(row.owner_employee_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

function mapStage(row: DbRow): CrmPipelineStage {
  return {
    id: String(row.id),
    name: String(row.name),
    sortOrder: Number(row.sort_order ?? 0),
    isWon: Boolean(row.is_won),
    isLost: Boolean(row.is_lost),
  };
}

function buildSummary(contacts: CrmContact[], companies: CrmCompany[], deals: CrmDeal[]): CrmSummary {
  const openDeals = deals.filter((d) => d.status === "open");
  return {
    contactCount: contacts.length,
    companyCount: companies.length,
    openDealCount: openDeals.length,
    openPipelineValue: openDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
    wonDealCount: deals.filter((d) => d.status === "won").length,
  };
}

export async function listCrmWorkspaceData(
  client: SupabaseClient,
  workspaceId: string,
  options?: { query?: string; limit?: number },
): Promise<CrmListPayload> {
  const limit = options?.limit ?? 200;
  const query = options?.query?.trim();

  const stagesRaw = await ensurePipelineStages(client, workspaceId);
  const stages: CrmPipelineStage[] = stagesRaw.map((s, index) => ({
    id: s.id,
    name: s.name,
    sortOrder: index,
    isWon: s.isWon,
    isLost: s.isLost,
  }));

  let contactsQuery = client
    .from("crm_contacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (query) {
    const q = `%${query}%`;
    contactsQuery = contactsQuery.or(
      `full_name.ilike.${q},email.ilike.${q},company_name.ilike.${q}`,
    );
  }

  let dealsQuery = client
    .from("crm_deals")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (query) {
    const q = `%${query}%`;
    dealsQuery = dealsQuery.or(`name.ilike.${q},stage_name.ilike.${q}`);
  }

  const [contactsRes, companiesRes, dealsRes] = await Promise.all([
    contactsQuery,
    client
      .from("crm_companies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit),
    dealsQuery,
  ]);

  if (contactsRes.error) throw contactsRes.error;
  if (companiesRes.error) throw companiesRes.error;
  if (dealsRes.error) throw dealsRes.error;

  const contacts = (contactsRes.data ?? []).map((row) => mapContact(row as DbRow));
  const companies = (companiesRes.data ?? []).map((row) => mapCompany(row as DbRow));
  const deals = (dealsRes.data ?? []).map((row) => mapDeal(row as DbRow));

  return {
    contacts,
    companies,
    deals,
    stages,
    summary: buildSummary(contacts, companies, deals),
  };
}

export async function getCrmContact(
  client: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<CrmContact | null> {
  const { data, error } = await client
    .from("crm_contacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapContact(data as DbRow) : null;
}

export async function getCrmDeal(
  client: SupabaseClient,
  workspaceId: string,
  dealId: string,
): Promise<CrmDeal | null> {
  const { data, error } = await client
    .from("crm_deals")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", dealId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDeal(data as DbRow) : null;
}
