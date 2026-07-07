import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type { InvestorStage } from "@/lib/investors/types";
import { nowISO, uid } from "@/lib/utils";
import {
  investorContactArtifact,
  investorFirmArtifact,
  investorPipelineArtifact,
} from "@/lib/integrations/investor-message-artifacts";
import { createTask } from "@/lib/integrations/adapters/adehq-tasks";

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

type CreateFirmArgs = {
  name: string;
  website?: string;
  focus?: string;
  stageFocus?: string;
  notes?: string;
};

type CreateInvestorContactArgs = {
  fullName: string;
  firmId?: string;
  firmName?: string;
  title?: string;
  email?: string;
  linkedinUrl?: string;
  notes?: string;
};

type UpdatePipelineArgs = {
  pipelineId?: string;
  firmId?: string;
  firmName?: string;
  contactId?: string;
  contactName?: string;
  stage?: InvestorStage;
  fitScore?: number;
  targetAmount?: number;
  currency?: string;
  notes?: string;
  nextFollowUpAt?: string;
};

type ScoreFitArgs = {
  pipelineId?: string;
  firmId?: string;
  firmName?: string;
  contactId?: string;
  contactName?: string;
  score: number;
  notes?: string;
};

type CreateFollowUpArgs = {
  title: string;
  description?: string;
  dueDate?: string;
  firmId?: string;
  firmName?: string;
  contactId?: string;
  contactName?: string;
  pipelineId?: string;
};

async function ensurePipelineRecord(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  params: { firmId?: string | null; contactId?: string | null },
): Promise<DbRow> {
  if (params.firmId) {
    const { data: existing, error } = await client
      .from("investor_pipeline")
      .select("id, stage, fit_score, firm_id, contact_id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("firm_id", params.firmId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (existing) return existing as DbRow;
  }

  const id = uid("pipeline");
  const { error: insertError } = await client.from("investor_pipeline").insert({
    workspace_id: ctx.workspaceId,
    id,
    firm_id: params.firmId ?? null,
    contact_id: params.contactId ?? null,
    stage: "target",
    owner_employee_id: ctx.employeeId,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (insertError) throw insertError;

  return {
    id,
    stage: "target",
    fit_score: null,
    firm_id: params.firmId ?? null,
    contact_id: params.contactId ?? null,
  };
}

async function findFirmByName(
  client: SupabaseClient,
  workspaceId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await client
    .from("investor_firms")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .ilike("name", name.trim())
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: String(data.id), name: String(data.name) } : null;
}

async function findOrCreateFirm(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  firmName: string,
): Promise<{ id: string; name: string }> {
  const existing = await findFirmByName(client, ctx.workspaceId, firmName);
  if (existing) return existing;

  const id = uid("firm");
  const trimmed = firmName.trim();
  const { error } = await client.from("investor_firms").insert({
    workspace_id: ctx.workspaceId,
    id,
    name: trimmed,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;
  return { id, name: trimmed };
}

async function resolveContactByName(
  client: SupabaseClient,
  workspaceId: string,
  contactName: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("investor_contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("full_name", `%${contactName.trim()}%`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? String(data.id) : null;
}

async function resolvePipelineRecord(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: {
    pipelineId?: string;
    firmId?: string;
    firmName?: string;
    contactId?: string;
    contactName?: string;
  },
): Promise<DbRow | null> {
  if (args.pipelineId?.trim()) {
    const { data, error } = await client
      .from("investor_pipeline")
      .select("id, stage, fit_score, firm_id, contact_id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", args.pipelineId.trim())
      .maybeSingle();
    if (error) throw error;
    return (data as DbRow | null) ?? null;
  }

  let firmId = args.firmId?.trim() || null;
  if (!firmId && args.firmName?.trim()) {
    const firm = await findFirmByName(client, ctx.workspaceId, args.firmName);
    firmId = firm?.id ?? null;
  }

  let contactId = args.contactId?.trim() || null;
  if (!contactId && args.contactName?.trim()) {
    contactId = await resolveContactByName(client, ctx.workspaceId, args.contactName);
  }

  let query = client
    .from("investor_pipeline")
    .select("id, stage, fit_score, firm_id, contact_id")
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (firmId) query = query.eq("firm_id", firmId);
  if (contactId) query = query.eq("contact_id", contactId);
  if (!firmId && !contactId) return null;

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as DbRow | null) ?? null;
}

export async function createFirm(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateFirmArgs,
): Promise<ToolExecutionOutput> {
  const existing = await findFirmByName(client, ctx.workspaceId, args.name);
  if (existing) {
    return {
      summary: `Firm ${existing.name} already exists — reused existing record.`,
      payload: { firmId: existing.id, deduped: true },
      objectId: existing.id,
      workLogAction: "investor_firm_reused",
      messageArtifact: investorFirmArtifact({
        firmId: existing.id,
        name: existing.name,
        stageFocus: args.stageFocus,
        website: args.website,
      }),
    };
  }

  const id = uid("firm");
  const { error } = await client.from("investor_firms").insert({
    workspace_id: ctx.workspaceId,
    id,
    name: args.name.trim(),
    website: args.website?.trim() ?? null,
    focus: args.focus?.trim() ?? null,
    stage_focus: args.stageFocus?.trim() ?? null,
    notes: args.notes ?? null,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;

  await ensurePipelineRecord(client, ctx, { firmId: id, contactId: null });

  return {
    summary: `Created investor firm ${args.name.trim()}.`,
    payload: { firmId: id },
    objectId: id,
    workLogAction: "investor_firm_created",
    messageArtifact: investorFirmArtifact({
      firmId: id,
      name: args.name.trim(),
      stageFocus: args.stageFocus,
      website: args.website,
    }),
  };
}

export async function createInvestorContact(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateInvestorContactArgs,
): Promise<ToolExecutionOutput> {
  if (args.email?.trim()) {
    const { data, error } = await client
      .from("investor_contacts")
      .select("id, full_name")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("email", args.email.trim())
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return {
        summary: `Contact ${String(data.full_name)} already exists — reused existing record.`,
        payload: { contactId: String(data.id), deduped: true },
        objectId: String(data.id),
        workLogAction: "investor_contact_reused",
        messageArtifact: investorContactArtifact({
          contactId: String(data.id),
          fullName: String(data.full_name),
          firmName: args.firmName,
          email: args.email,
        }),
      };
    }
  }

  let firmId = args.firmId?.trim() ?? null;
  let firmName = args.firmName?.trim() ?? null;
  if (!firmId && firmName) {
    const firm = await findOrCreateFirm(client, ctx, firmName);
    firmId = firm.id;
    firmName = firm.name;
  } else if (firmId && !firmName) {
    const { data, error } = await client
      .from("investor_firms")
      .select("name")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", firmId)
      .maybeSingle();
    if (error) throw error;
    firmName = data?.name ? String(data.name) : null;
  }

  const id = uid("investor_contact");
  const { error } = await client.from("investor_contacts").insert({
    workspace_id: ctx.workspaceId,
    id,
    firm_id: firmId,
    full_name: args.fullName.trim(),
    title: args.title?.trim() ?? null,
    email: args.email?.trim() ?? null,
    linkedin_url: args.linkedinUrl?.trim() ?? null,
    notes: args.notes ?? null,
    owner_employee_id: ctx.employeeId,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });
  if (error) throw error;

  await ensurePipelineRecord(client, ctx, { firmId, contactId: id });

  return {
    summary: `Created investor contact ${args.fullName.trim()}${firmName ? ` at ${firmName}` : ""}.`,
    payload: { contactId: id, firmId },
    objectId: id,
    workLogAction: "investor_contact_created",
    messageArtifact: investorContactArtifact({
      contactId: id,
      fullName: args.fullName.trim(),
      firmName,
      email: args.email,
    }),
  };
}

export async function updatePipeline(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: UpdatePipelineArgs,
): Promise<ToolExecutionOutput> {
  let row = await resolvePipelineRecord(client, ctx, args);
  if (!row) {
    let firmId = args.firmId?.trim() || null;
    if (!firmId && args.firmName?.trim()) {
      const firm = await findFirmByName(client, ctx.workspaceId, args.firmName);
      firmId = firm?.id ?? null;
    }
    let contactId = args.contactId?.trim() || null;
    if (!contactId && args.contactName?.trim()) {
      contactId = await resolveContactByName(client, ctx.workspaceId, args.contactName);
    }
    if (!firmId && !contactId) {
      throw new Error(
        "Pipeline record not found. Provide pipelineId, or firm/contact references to create or update a record.",
      );
    }
    row = await ensurePipelineRecord(client, ctx, { firmId, contactId });
  }

  const patch: Record<string, unknown> = {
    updated_at: nowISO(),
  };
  if (args.stage) {
    const stage = args.stage.trim().toLowerCase() as InvestorStage;
    if (!INVESTOR_STAGES.includes(stage)) {
      throw new Error(`Unknown stage "${args.stage}". Available stages: ${INVESTOR_STAGES.join(", ")}.`);
    }
    patch.stage = stage;
  }
  if (args.targetAmount !== undefined) patch.target_amount = args.targetAmount;
  if (args.currency !== undefined) patch.currency = args.currency.trim().toUpperCase();
  if (args.notes !== undefined) patch.notes = args.notes;
  if (args.nextFollowUpAt !== undefined) patch.next_follow_up_at = args.nextFollowUpAt;
  if (args.fitScore !== undefined) patch.fit_score = Math.round(args.fitScore);

  if (Object.keys(patch).length === 1) {
    throw new Error("No pipeline fields provided to update.");
  }

  const recordId = String(row.id);
  const { error } = await client
    .from("investor_pipeline")
    .update(patch)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId);
  if (error) throw error;

  const { data: updated, error: refetchError } = await client
    .from("investor_pipeline")
    .select("id, stage, fit_score, firm_id, contact_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId)
    .maybeSingle();
  if (refetchError) throw refetchError;

  return {
    summary: `Updated investor pipeline record ${recordId}.`,
    payload: {
      pipelineId: recordId,
      stage: updated?.stage ? String(updated.stage) : undefined,
      fitScore: updated?.fit_score != null ? Number(updated.fit_score) : null,
    },
    objectId: recordId,
    workLogAction: "investor_pipeline_updated",
    messageArtifact: investorPipelineArtifact({
      pipelineId: recordId,
      stage: updated?.stage ? String(updated.stage) : undefined,
      fitScore: updated?.fit_score != null ? Number(updated.fit_score) : null,
    }),
  };
}

export async function scoreFit(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: ScoreFitArgs,
): Promise<ToolExecutionOutput> {
  if (!Number.isFinite(args.score) || args.score < 0 || args.score > 100) {
    throw new Error("score must be a number between 0 and 100.");
  }

  const row = await resolvePipelineRecord(client, ctx, args);
  const pipelineRow =
    row ??
    (await (async () => {
      let firmId = args.firmId?.trim() || null;
      if (!firmId && args.firmName?.trim()) {
        const firm = await findFirmByName(client, ctx.workspaceId, args.firmName);
        firmId = firm?.id ?? null;
      }
      let contactId = args.contactId?.trim() || null;
      if (!contactId && args.contactName?.trim()) {
        contactId = await resolveContactByName(client, ctx.workspaceId, args.contactName);
      }
      if (!firmId && !contactId) return null;
      return ensurePipelineRecord(client, ctx, { firmId, contactId });
    })());

  if (!pipelineRow) {
    throw new Error(
      "Pipeline record not found. Provide pipelineId, or a firm/contact reference.",
    );
  }

  const recordId = String(pipelineRow.id);
  const { error } = await client
    .from("investor_pipeline")
    .update({
      fit_score: Math.round(args.score),
      notes: args.notes ?? undefined,
      updated_at: nowISO(),
    })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId);
  if (error) throw error;

  const { data: updated, error: refetchError } = await client
    .from("investor_pipeline")
    .select("id, stage, fit_score")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId)
    .maybeSingle();
  if (refetchError) throw refetchError;

  const fitScore = updated?.fit_score != null ? Number(updated.fit_score) : Math.round(args.score);
  return {
    summary: `Scored investor pipeline record ${recordId} with fit score ${fitScore}/100.`,
    payload: { pipelineId: recordId, fitScore },
    objectId: recordId,
    workLogAction: "investor_pipeline_fit_scored",
    messageArtifact: investorPipelineArtifact({
      pipelineId: recordId,
      stage: updated?.stage ? String(updated.stage) : undefined,
      fitScore,
    }),
  };
}

export async function createFollowUp(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateFollowUpArgs,
): Promise<ToolExecutionOutput> {
  const firmRef = [args.firmName, args.firmId].filter(Boolean).join(" ");
  const contactRef = [args.contactName, args.contactId].filter(Boolean).join(" ");
  const description = [
    args.description,
    firmRef ? `Firm: ${firmRef}` : null,
    contactRef ? `Contact: ${contactRef}` : null,
    args.pipelineId ? `Pipeline: ${args.pipelineId}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const taskResult = await createTask(client, ctx, {
    title: args.title.trim(),
    description: description || undefined,
    dueDate: args.dueDate,
    assigneeType: "ai",
    assigneeId: ctx.employeeId,
  });

  return {
    ...taskResult,
    summary: `Created investor follow-up: ${args.title.trim()}.`,
    workLogAction: "investor_follow_up_created",
  };
}
