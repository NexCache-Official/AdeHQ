// ===========================================================================
// AdeHQ CRM adapter — internal provider for crm.* tools.
// Backs the Sales vertical slice: contacts, companies, deals, stages.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type {
  CreateCompanyArgs,
  CreateContactArgs,
  CreateDealArgs,
  ListContactsArgs,
  ListDealsArgs,
  UpdateDealStageArgs,
} from "@/lib/integrations/registry/tool-definitions";
import { nowISO, uid } from "@/lib/utils";
import {
  crmCompanyArtifact,
  crmContactArtifact,
  crmDealArtifact,
} from "@/lib/integrations/crm-message-artifacts";
import { formatDealAmount } from "@/lib/crm/client";

type DbRow = Record<string, unknown>;

export const DEFAULT_PIPELINE_STAGES = [
  { name: "Lead", sortOrder: 0, isWon: false, isLost: false },
  { name: "Qualified", sortOrder: 1, isWon: false, isLost: false },
  { name: "Proposal", sortOrder: 2, isWon: false, isLost: false },
  { name: "Negotiation", sortOrder: 3, isWon: false, isLost: false },
  { name: "Won", sortOrder: 4, isWon: true, isLost: false },
  { name: "Lost", sortOrder: 5, isWon: false, isLost: true },
];

/** Seed the default pipeline on first use — idempotent per workspace. */
export async function ensurePipelineStages(
  client: SupabaseClient,
  workspaceId: string,
): Promise<Array<{ id: string; name: string; isWon: boolean; isLost: boolean }>> {
  const { data, error } = await client
    .from("crm_pipeline_stages")
    .select("id, name, is_won, is_lost")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  if (data?.length) {
    return data.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      isWon: Boolean(row.is_won),
      isLost: Boolean(row.is_lost),
    }));
  }

  const rows = DEFAULT_PIPELINE_STAGES.map((stage) => ({
    workspace_id: workspaceId,
    id: uid("stage"),
    name: stage.name,
    sort_order: stage.sortOrder,
    is_won: stage.isWon,
    is_lost: stage.isLost,
  }));
  const { error: insertError } = await client
    .from("crm_pipeline_stages")
    .upsert(rows, { onConflict: "workspace_id,name", ignoreDuplicates: true });
  if (insertError) throw insertError;

  const { data: seeded, error: refetchError } = await client
    .from("crm_pipeline_stages")
    .select("id, name, is_won, is_lost")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });
  if (refetchError) throw refetchError;
  return (seeded ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    isWon: Boolean(row.is_won),
    isLost: Boolean(row.is_lost),
  }));
}

async function findOrCreateCompany(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  companyName: string,
): Promise<string> {
  const { data, error } = await client
    .from("crm_companies")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .ilike("name", companyName.trim())
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data) return String(data.id);

  const id = uid("company");
  const { error: insertError } = await client.from("crm_companies").insert({
    workspace_id: ctx.workspaceId,
    id,
    name: companyName.trim(),
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (insertError) throw insertError;
  return id;
}

export async function createContact(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateContactArgs,
): Promise<ToolExecutionOutput> {
  const fullName = [args.firstName, args.lastName].filter(Boolean).join(" ").trim();

  // Soft dedupe: same email (or same full name when no email) returns existing.
  if (args.email?.trim()) {
    const { data } = await client
      .from("crm_contacts")
      .select("id, full_name")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("email", args.email.trim())
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        summary: `Contact ${String(data.full_name)} already exists — reused existing record.`,
        payload: { contactId: String(data.id), deduped: true },
        objectId: String(data.id),
        workLogAction: "crm_contact_reused",
        relatedEntityType: "contact",
        relatedEntityId: String(data.id),
        messageArtifact: crmContactArtifact({
          contactId: String(data.id),
          fullName: String(data.full_name),
          email: args.email,
          companyName: args.companyName,
        }),
      };
    }
  }

  const companyId = args.companyName
    ? await findOrCreateCompany(client, ctx, args.companyName)
    : null;

  const id = uid("contact");
  const { error } = await client.from("crm_contacts").insert({
    workspace_id: ctx.workspaceId,
    id,
    first_name: args.firstName.trim(),
    last_name: args.lastName?.trim() ?? null,
    full_name: fullName,
    email: args.email?.trim() ?? null,
    phone: args.phone?.trim() ?? null,
    title: args.title?.trim() ?? null,
    company_id: companyId,
    company_name: args.companyName?.trim() ?? null,
    notes: args.notes ?? null,
    source: args.source ?? null,
    owner_employee_id: ctx.employeeId,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;

  return {
    summary: `Created contact ${fullName}${args.companyName ? ` at ${args.companyName}` : ""}.`,
    payload: { contactId: id, fullName, companyId },
    objectId: id,
    workLogAction: "crm_contact_created",
    relatedEntityType: "contact",
    relatedEntityId: id,
    messageArtifact: crmContactArtifact({
      contactId: id,
      fullName,
      email: args.email,
      companyName: args.companyName,
    }),
  };
}

export async function createCompany(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateCompanyArgs,
): Promise<ToolExecutionOutput> {
  const { data: existing } = await client
    .from("crm_companies")
    .select("id, name")
    .eq("workspace_id", ctx.workspaceId)
    .ilike("name", args.name.trim())
    .limit(1)
    .maybeSingle();
  if (existing) {
    return {
      summary: `Company ${String(existing.name)} already exists — reused existing record.`,
      payload: { companyId: String(existing.id), deduped: true },
      objectId: String(existing.id),
      workLogAction: "crm_company_reused",
      relatedEntityType: "company",
      relatedEntityId: String(existing.id),
      messageArtifact: crmCompanyArtifact({
        companyId: String(existing.id),
        name: String(existing.name),
      }),
    };
  }

  const id = uid("company");
  const { error } = await client.from("crm_companies").insert({
    workspace_id: ctx.workspaceId,
    id,
    name: args.name.trim(),
    domain: args.domain?.trim() ?? null,
    industry: args.industry?.trim() ?? null,
    notes: args.notes ?? null,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;

  return {
    summary: `Created company ${args.name}.`,
    payload: { companyId: id },
    objectId: id,
    workLogAction: "crm_company_created",
    relatedEntityType: "company",
    relatedEntityId: id,
    messageArtifact: crmCompanyArtifact({
      companyId: id,
      name: args.name,
      industry: args.industry,
    }),
  };
}

async function resolveContactByName(
  client: SupabaseClient,
  workspaceId: string,
  contactName: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("crm_contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("full_name", `%${contactName.trim()}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? String(data.id) : null;
}

export async function createDeal(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateDealArgs,
): Promise<ToolExecutionOutput> {
  const stages = await ensurePipelineStages(client, ctx.workspaceId);
  const requestedStage = (args.stage ?? "Lead").trim().toLowerCase();
  const stage =
    stages.find((s) => s.name.toLowerCase() === requestedStage) ??
    stages.find((s) => s.name === "Lead") ??
    stages[0];

  const contactId =
    args.contactId ??
    (args.contactName
      ? await resolveContactByName(client, ctx.workspaceId, args.contactName)
      : null);
  const companyId = args.companyName
    ? await findOrCreateCompany(client, ctx, args.companyName)
    : null;

  const id = uid("deal");
  const { error } = await client.from("crm_deals").insert({
    workspace_id: ctx.workspaceId,
    id,
    name: args.name.trim(),
    amount: args.amount ?? null,
    currency: (args.currency ?? "USD").toUpperCase(),
    stage_id: stage?.id ?? null,
    stage_name: stage?.name ?? "Lead",
    status: stage?.isWon ? "won" : stage?.isLost ? "lost" : "open",
    contact_id: contactId,
    company_id: companyId,
    expected_close_date: args.expectedCloseDate ?? null,
    notes: [
      args.notes,
      args.contactName && !contactId ? `Contact (unmatched): ${args.contactName}` : null,
    ]
      .filter(Boolean)
      .join("\n") || null,
    owner_employee_id: ctx.employeeId,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;

  const amountLabel =
    args.amount != null ? ` (${(args.currency ?? "USD").toUpperCase()} ${args.amount.toLocaleString()})` : "";
  return {
    summary: `Created deal "${args.name}"${amountLabel} in stage ${stage?.name ?? "Lead"}.`,
    payload: { dealId: id, stage: stage?.name ?? "Lead", contactId, companyId },
    objectId: id,
    workLogAction: "crm_deal_created",
    relatedEntityType: "deal",
    relatedEntityId: id,
    messageArtifact: crmDealArtifact({
      dealId: id,
      name: args.name,
      stage: stage?.name ?? "Lead",
      amountLabel: args.amount != null ? formatDealAmount(args.amount, args.currency) : undefined,
    }),
  };
}

export async function updateDealStage(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: UpdateDealStageArgs,
): Promise<ToolExecutionOutput> {
  let dealRow: DbRow | null = null;
  if (args.dealId) {
    const { data, error } = await client
      .from("crm_deals")
      .select("id, name")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", args.dealId)
      .maybeSingle();
    if (error) throw error;
    dealRow = data as DbRow | null;
  } else if (args.dealName) {
    const { data, error } = await client
      .from("crm_deals")
      .select("id, name")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("name", `%${args.dealName.trim()}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    dealRow = data as DbRow | null;
  }

  if (!dealRow) {
    throw new Error(
      `Deal not found${args.dealName ? ` matching "${args.dealName}"` : ""}. Use crm.listDeals to check the pipeline.`,
    );
  }

  const stages = await ensurePipelineStages(client, ctx.workspaceId);
  const stage = stages.find((s) => s.name.toLowerCase() === args.stage.trim().toLowerCase());
  if (!stage) {
    throw new Error(
      `Unknown stage "${args.stage}". Available stages: ${stages.map((s) => s.name).join(", ")}.`,
    );
  }

  const { error } = await client
    .from("crm_deals")
    .update({
      stage_id: stage.id,
      stage_name: stage.name,
      status: stage.isWon ? "won" : stage.isLost ? "lost" : "open",
      updated_at: nowISO(),
    })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", String(dealRow.id));
  if (error) throw error;

  return {
    summary: `Moved deal "${String(dealRow.name)}" to ${stage.name}.`,
    payload: { dealId: String(dealRow.id), stage: stage.name },
    objectId: String(dealRow.id),
    workLogAction: "crm_deal_stage_updated",
  };
}

export async function listContacts(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: ListContactsArgs,
): Promise<ToolExecutionOutput> {
  let query = client
    .from("crm_contacts")
    .select("id, full_name, email, title, company_name, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 10);
  if (args.query?.trim()) {
    const q = `%${args.query.trim()}%`;
    query = query.or(`full_name.ilike.${q},email.ilike.${q},company_name.ilike.${q}`);
  }
  const { data, error } = await query;
  if (error) throw error;

  const contacts = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.full_name),
    email: row.email ? String(row.email) : null,
    title: row.title ? String(row.title) : null,
    company: row.company_name ? String(row.company_name) : null,
  }));

  return {
    summary: `Found ${contacts.length} contact${contacts.length === 1 ? "" : "s"}.`,
    payload: { contacts },
  };
}

export async function listDeals(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: ListDealsArgs,
): Promise<ToolExecutionOutput> {
  let query = client
    .from("crm_deals")
    .select("id, name, amount, currency, stage_name, status, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 10);
  if (args.stage?.trim()) query = query.ilike("stage_name", args.stage.trim());
  if (args.status) query = query.eq("status", args.status);
  const { data, error } = await query;
  if (error) throw error;

  const deals = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    amount: row.amount != null ? Number(row.amount) : null,
    currency: String(row.currency ?? "USD"),
    stage: String(row.stage_name),
    status: String(row.status),
  }));

  return {
    summary: `Found ${deals.length} deal${deals.length === 1 ? "" : "s"}.`,
    payload: { deals },
  };
}
