import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaybookDefinitionV1, PlaybookRunStatus, PlaybookStepStatus } from "./contracts";
import { stableChecksum } from "./checksum";

export type PlaybookRow = {
  id: string;
  workspace_id: string | null;
  key: string;
  name: string;
  description: string | null;
  category: string;
  industry_tags: string[];
  visibility: string;
  status: string;
  current_version_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaybookVersionRow = {
  id: string;
  playbook_id: string;
  version: number;
  definition: PlaybookDefinitionV1;
  schema_version: number;
  checksum: string;
  estimated_wh_min: number | null;
  estimated_wh_max: number | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type PlaybookRunRow = {
  id: string;
  workspace_id: string;
  playbook_id: string;
  playbook_version_id: string;
  brain_run_id: string | null;
  room_id: string | null;
  topic_id: string | null;
  work_item_id: string | null;
  initiated_by_user_id: string;
  status: PlaybookRunStatus;
  input_payload: Record<string, unknown>;
  output_summary: Record<string, unknown> | null;
  estimated_wh_min: number | null;
  estimated_wh_max: number | null;
  hard_wh_limit: number | null;
  actual_wh: number;
  selected_employee_ids: string[];
  plan_snapshot: Record<string, unknown> | null;
  approval_id: string | null;
  idempotency_key: string;
  error_code: string | null;
  safe_error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaybookRunStepRow = {
  id: string;
  playbook_run_id: string;
  step_key: string;
  /** Stores brain_capability_steps.id (column name brain_step_id in SQL). */
  brain_step_id: string | null;
  status: PlaybookStepStatus;
  assigned_employee_id: string | null;
  depends_on: string[];
  input_snapshot: Record<string, unknown> | null;
  output_payload: Record<string, unknown> | null;
  output_artifact_id: string | null;
  attempt_count: number;
  estimated_wh: number | null;
  actual_wh: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  error_code: string | null;
  safe_error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listPlaybooks(
  client: SupabaseClient,
  opts: { workspaceId?: string | null; status?: string; limit?: number } = {},
): Promise<PlaybookRow[]> {
  let q = client.from("playbooks").select("*").order("updated_at", { ascending: false });
  if (opts.workspaceId) q = q.or(`workspace_id.eq.${opts.workspaceId},visibility.eq.platform`);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PlaybookRow[];
}

export async function getPlaybook(
  client: SupabaseClient,
  playbookId: string,
): Promise<{ playbook: PlaybookRow; version: PlaybookVersionRow | null } | null> {
  const { data: playbook, error } = await client
    .from("playbooks")
    .select("*")
    .eq("id", playbookId)
    .maybeSingle();
  if (error) throw error;
  if (!playbook) return null;

  let version: PlaybookVersionRow | null = null;
  if (playbook.current_version_id) {
    const { data: ver, error: verErr } = await client
      .from("playbook_versions")
      .select("*")
      .eq("id", playbook.current_version_id)
      .maybeSingle();
    if (verErr) throw verErr;
    version = (ver as PlaybookVersionRow) ?? null;
  }

  return { playbook: playbook as PlaybookRow, version };
}

export async function createPlaybookVersion(
  client: SupabaseClient,
  input: {
    playbookId: string;
    version: number;
    definition: PlaybookDefinitionV1;
    estimatedWhMin?: number;
    estimatedWhMax?: number;
    createdByUserId?: string | null;
    setAsCurrent?: boolean;
  },
): Promise<PlaybookVersionRow> {
  const checksum = stableChecksum(input.definition);
  const { data, error } = await client
    .from("playbook_versions")
    .insert({
      playbook_id: input.playbookId,
      version: input.version,
      definition: input.definition,
      schema_version: 1,
      checksum,
      estimated_wh_min: input.estimatedWhMin ?? null,
      estimated_wh_max: input.estimatedWhMax ?? null,
      created_by_user_id: input.createdByUserId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;

  if (input.setAsCurrent !== false) {
    const { error: updErr } = await client
      .from("playbooks")
      .update({ current_version_id: data.id })
      .eq("id", input.playbookId);
    if (updErr) throw updErr;
  }

  return data as PlaybookVersionRow;
}

export async function createPlaybookRun(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    playbookId: string;
    playbookVersionId: string;
    initiatedByUserId: string;
    idempotencyKey: string;
    brainRunId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
    workItemId?: string | null;
    status?: PlaybookRunStatus;
    inputPayload?: Record<string, unknown>;
    estimatedWhMin?: number | null;
    estimatedWhMax?: number | null;
    hardWhLimit?: number | null;
    selectedEmployeeIds?: string[];
    planSnapshot?: Record<string, unknown> | null;
  },
): Promise<PlaybookRunRow> {
  const { data, error } = await client
    .from("playbook_runs")
    .insert({
      workspace_id: input.workspaceId,
      playbook_id: input.playbookId,
      playbook_version_id: input.playbookVersionId,
      brain_run_id: input.brainRunId ?? null,
      room_id: input.roomId ?? null,
      topic_id: input.topicId ?? null,
      work_item_id: input.workItemId ?? null,
      initiated_by_user_id: input.initiatedByUserId,
      status: input.status ?? "queued",
      input_payload: input.inputPayload ?? {},
      estimated_wh_min: input.estimatedWhMin ?? null,
      estimated_wh_max: input.estimatedWhMax ?? null,
      hard_wh_limit: input.hardWhLimit ?? null,
      selected_employee_ids: input.selectedEmployeeIds ?? [],
      plan_snapshot: input.planSnapshot ?? null,
      idempotency_key: input.idempotencyKey,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PlaybookRunRow;
}

export async function getPlaybookRun(
  client: SupabaseClient,
  runId: string,
): Promise<{ run: PlaybookRunRow; steps: PlaybookRunStepRow[] } | null> {
  const { data: run, error } = await client
    .from("playbook_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  if (!run) return null;

  const { data: steps, error: stepErr } = await client
    .from("playbook_run_steps")
    .select("*")
    .eq("playbook_run_id", runId)
    .order("created_at", { ascending: true });
  if (stepErr) throw stepErr;

  return { run: run as PlaybookRunRow, steps: (steps ?? []) as PlaybookRunStepRow[] };
}

export async function updatePlaybookRunStatus(
  client: SupabaseClient,
  runId: string,
  status: PlaybookRunStatus,
  patch: Partial<{
    error_code: string | null;
    safe_error_message: string | null;
    actual_wh: number;
    output_summary: Record<string, unknown> | null;
    brain_run_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
  }> = {},
): Promise<PlaybookRunRow> {
  const { data, error } = await client
    .from("playbook_runs")
    .update({ status, ...patch })
    .eq("id", runId)
    .select("*")
    .single();
  if (error) throw error;
  return data as PlaybookRunRow;
}

export async function upsertPlaybookRunStep(
  client: SupabaseClient,
  input: {
    playbookRunId: string;
    stepKey: string;
    status?: PlaybookStepStatus;
    brainStepId?: string | null;
    assignedEmployeeId?: string | null;
    dependsOn?: string[];
    inputSnapshot?: Record<string, unknown> | null;
    outputPayload?: Record<string, unknown> | null;
    outputArtifactId?: string | null;
    attemptCount?: number;
    estimatedWh?: number | null;
    actualWh?: number;
    errorCode?: string | null;
    safeErrorMessage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  },
): Promise<PlaybookRunStepRow> {
  const row = {
    playbook_run_id: input.playbookRunId,
    step_key: input.stepKey,
    status: input.status ?? "pending",
    brain_step_id: input.brainStepId ?? null,
    assigned_employee_id: input.assignedEmployeeId ?? null,
    depends_on: input.dependsOn ?? [],
    input_snapshot: input.inputSnapshot ?? null,
    output_payload: input.outputPayload ?? null,
    output_artifact_id: input.outputArtifactId ?? null,
    attempt_count: input.attemptCount ?? 0,
    estimated_wh: input.estimatedWh ?? null,
    actual_wh: input.actualWh ?? 0,
    error_code: input.errorCode ?? null,
    safe_error_message: input.safeErrorMessage ?? null,
    started_at: input.startedAt ?? null,
    completed_at: input.completedAt ?? null,
  };

  const { data, error } = await client
    .from("playbook_run_steps")
    .upsert(row, { onConflict: "playbook_run_id,step_key" })
    .select("*")
    .single();
  if (error) throw error;
  return data as PlaybookRunStepRow;
}
