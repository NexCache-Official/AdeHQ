import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePipelineStages } from "@/lib/integrations/adapters/adehq-crm";
import type { CrmCompany, CrmContact, CrmDeal } from "@/lib/crm/types";
import { getCrmContact, getCrmDeal } from "./crm-queries";

type DbRow = Record<string, unknown>;

export async function updateCrmContact(
  client: SupabaseClient,
  workspaceId: string,
  contactId: string,
  patch: {
    firstName?: string;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    companyName?: string | null;
    notes?: string | null;
    archived?: boolean;
  },
  actorUserId: string,
): Promise<CrmContact> {
  const existing = await getCrmContact(client, workspaceId, contactId);
  if (!existing) throw new Error("Contact not found.");

  const firstName = patch.firstName?.trim() ?? existing.firstName;
  const lastName = patch.lastName !== undefined ? patch.lastName : existing.lastName;
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  const { error } = await client
    .from("crm_contacts")
    .update({
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      email: patch.email !== undefined ? patch.email : existing.email,
      phone: patch.phone !== undefined ? patch.phone : existing.phone,
      title: patch.title !== undefined ? patch.title : existing.title,
      company_name: patch.companyName !== undefined ? patch.companyName : existing.companyName,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", contactId);
  if (error) throw error;

  if (patch.archived) {
    await client
      .from("crm_contacts")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", contactId);
  }

  void actorUserId;
  const updated = await getCrmContact(client, workspaceId, contactId);
  if (!updated && !patch.archived) throw new Error("Contact update failed.");
  return updated ?? existing;
}

export async function updateCrmCompany(
  client: SupabaseClient,
  workspaceId: string,
  companyId: string,
  patch: {
    name?: string;
    domain?: string | null;
    industry?: string | null;
    notes?: string | null;
    archived?: boolean;
  },
): Promise<CrmCompany | null> {
  const { data: existing, error: loadError } = await client
    .from("crm_companies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", companyId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing) throw new Error("Company not found.");

  if (patch.archived) {
    const { error } = await client
      .from("crm_companies")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", companyId);
    if (error) throw error;
    return null;
  }

  const { error } = await client
    .from("crm_companies")
    .update({
      name: patch.name?.trim() ?? String(existing.name),
      domain: patch.domain !== undefined ? patch.domain : existing.domain,
      industry: patch.industry !== undefined ? patch.industry : existing.industry,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", companyId);
  if (error) throw error;

  const { data, error: reloadError } = await client
    .from("crm_companies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", companyId)
    .maybeSingle();
  if (reloadError) throw reloadError;
  if (!data) throw new Error("Company update failed.");

  const row = data as DbRow;
  return {
    id: String(row.id),
    name: String(row.name),
    domain: row.domain ? String(row.domain) : null,
    industry: row.industry ? String(row.industry) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
  };
}

export async function updateCrmDeal(
  client: SupabaseClient,
  workspaceId: string,
  dealId: string,
  patch: {
    name?: string;
    amount?: number | null;
    currency?: string;
    stageName?: string;
    status?: "open" | "won" | "lost";
    expectedCloseDate?: string | null;
    notes?: string | null;
    archived?: boolean;
  },
): Promise<CrmDeal | null> {
  const existing = await getCrmDeal(client, workspaceId, dealId);
  if (!existing) throw new Error("Deal not found.");

  if (patch.archived) {
    const { error } = await client
      .from("crm_deals")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", dealId);
    if (error) throw error;
    return null;
  }

  let stageId = existing.stageId;
  let stageName = existing.stageName;
  let status = existing.status;

  if (patch.stageName) {
    const stages = await ensurePipelineStages(client, workspaceId);
    const match = stages.find((s) => s.name.toLowerCase() === patch.stageName!.toLowerCase());
    if (match) {
      stageId = match.id;
      stageName = match.name;
      if (match.isWon) status = "won";
      else if (match.isLost) status = "lost";
      else status = "open";
    } else {
      stageName = patch.stageName;
    }
  }

  if (patch.status) status = patch.status;

  const { error } = await client
    .from("crm_deals")
    .update({
      name: patch.name?.trim() ?? existing.name,
      amount: patch.amount !== undefined ? patch.amount : existing.amount,
      currency: patch.currency ?? existing.currency,
      stage_id: stageId,
      stage_name: stageName,
      status,
      expected_close_date:
        patch.expectedCloseDate !== undefined
          ? patch.expectedCloseDate
          : existing.expectedCloseDate,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", dealId);
  if (error) throw error;

  return getCrmDeal(client, workspaceId, dealId);
}
