// Server-side blueprint CRUD: draft/revision/approved-snapshot separation,
// draft locking with optimistic concurrency, and canonical-hash freezing at
// approval. Always called with a service-role client from API routes after
// requireHireAdmin() — see AGENTS.md "service-role only on the server".

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { canonicalHash } from "./canonical";
import type { SimulationReport, WorkforceBlueprintPayload, WorkforceBlueprintRecord } from "./types";

export const SCHEMA_VERSION = 1;
export const TEMPLATE_ENGINE_VERSION = "1.0.0";
export const COMPOSITION_RULES_VERSION = "1.0.0";
export const SIMULATION_ENGINE_VERSION = "1.0.0";
export const LOCK_TTL_MS = 120_000;

export class BlueprintNotFoundError extends Error {
  constructor() {
    super("Workforce blueprint not found.");
    this.name = "BlueprintNotFoundError";
  }
}

export class BlueprintLockConflictError extends Error {
  lockedByUserId: string | null;
  constructor(lockedByUserId: string | null) {
    super("Someone else is currently editing this blueprint.");
    this.name = "BlueprintLockConflictError";
    this.lockedByUserId = lockedByUserId;
  }
}

export class BlueprintRevisionConflictError extends Error {
  currentRevision: number;
  constructor(currentRevision: number) {
    super("This blueprint changed since you last loaded it.");
    this.name = "BlueprintRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

type BlueprintRow = {
  id: string;
  workspace_id: string;
  name: string;
  template_key: string;
  template_version: string;
  blueprint_mode: string;
  status: string;
  schema_version: number;
  template_engine_version: string;
  composition_rules_version: string;
  simulation_engine_version: string;
  revision: number;
  draft_payload: WorkforceBlueprintPayload;
  approved_revision: number | null;
  approved_payload: WorkforceBlueprintPayload | null;
  approval_hash: string | null;
  approved_by: string | null;
  approved_at: string | null;
  lock_token: string | null;
  locked_by_user_id: string | null;
  lock_acquired_at: string | null;
  lock_expires_at: string | null;
  simulation_report: SimulationReport | null;
  simulated_at: string | null;
  superseded_by_blueprint_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function rowToRecord(row: BlueprintRow): WorkforceBlueprintRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    blueprintMode: row.blueprint_mode as WorkforceBlueprintRecord["blueprintMode"],
    status: row.status as WorkforceBlueprintRecord["status"],
    schemaVersion: row.schema_version,
    templateEngineVersion: row.template_engine_version,
    compositionRulesVersion: row.composition_rules_version,
    simulationEngineVersion: row.simulation_engine_version,
    revision: row.revision,
    draftPayload: row.draft_payload,
    approvedRevision: row.approved_revision,
    approvedPayload: row.approved_payload,
    approvalHash: row.approval_hash,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    lockToken: row.lock_token,
    lockedByUserId: row.locked_by_user_id,
    lockAcquiredAt: row.lock_acquired_at,
    lockExpiresAt: row.lock_expires_at,
    simulationReport: row.simulation_report,
    simulatedAt: row.simulated_at,
    supersededByBlueprintId: row.superseded_by_blueprint_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS =
  "id, workspace_id, name, template_key, template_version, blueprint_mode, status, schema_version, template_engine_version, composition_rules_version, simulation_engine_version, revision, draft_payload, approved_revision, approved_payload, approval_hash, approved_by, approved_at, lock_token, locked_by_user_id, lock_acquired_at, lock_expires_at, simulation_report, simulated_at, superseded_by_blueprint_id, created_by, created_at, updated_at";

export async function createDraftBlueprint(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    createdBy: string;
    name: string;
    templateKey: string;
    templateVersion: string;
    payload: WorkforceBlueprintPayload;
  },
): Promise<WorkforceBlueprintRecord> {
  const { data, error } = await client
    .from("workforce_blueprints")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name,
      template_key: params.templateKey,
      template_version: params.templateVersion,
      blueprint_mode: "new_team",
      status: "draft",
      schema_version: SCHEMA_VERSION,
      template_engine_version: TEMPLATE_ENGINE_VERSION,
      composition_rules_version: COMPOSITION_RULES_VERSION,
      simulation_engine_version: SIMULATION_ENGINE_VERSION,
      revision: 1,
      draft_payload: params.payload,
      created_by: params.createdBy,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error || !data) throw error ?? new Error("Failed to create workforce blueprint.");

  await client.from("workforce_blueprint_revisions").insert({
    blueprint_id: data.id,
    workspace_id: params.workspaceId,
    revision: 1,
    payload: params.payload,
    change_summary: "Composed from template",
    changed_by: params.createdBy,
  });

  await logEvent(client, {
    workspaceId: params.workspaceId,
    blueprintId: data.id,
    eventType: "blueprint_created",
    payload: { templateKey: params.templateKey },
    createdBy: params.createdBy,
  });

  return rowToRecord(data as BlueprintRow);
}

export async function getBlueprint(
  client: SupabaseClient,
  workspaceId: string,
  blueprintId: string,
): Promise<WorkforceBlueprintRecord> {
  const { data, error } = await client
    .from("workforce_blueprints")
    .select(SELECT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", blueprintId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BlueprintNotFoundError();
  return rowToRecord(data as BlueprintRow);
}

export async function listBlueprints(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkforceBlueprintRecord[]> {
  const { data, error } = await client
    .from("workforce_blueprints")
    .select(SELECT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => rowToRecord(row as BlueprintRow));
}

/** Atomically acquire (or refresh, if already held by the same user) the
 * draft lock. Expired locks are treated as free. */
export async function acquireBlueprintLock(
  client: SupabaseClient,
  workspaceId: string,
  blueprintId: string,
  userId: string,
): Promise<{ lockToken: string; lockExpiresAt: string }> {
  const current = await getBlueprint(client, workspaceId, blueprintId);
  const now = Date.now();
  const heldByOther =
    current.lockToken &&
    current.lockedByUserId &&
    current.lockedByUserId !== userId &&
    current.lockExpiresAt &&
    new Date(current.lockExpiresAt).getTime() > now;
  if (heldByOther) {
    throw new BlueprintLockConflictError(current.lockedByUserId);
  }

  const lockToken = randomUUID();
  const lockExpiresAt = new Date(now + LOCK_TTL_MS).toISOString();

  let query = client
    .from("workforce_blueprints")
    .update({
      lock_token: lockToken,
      locked_by_user_id: userId,
      lock_acquired_at: new Date(now).toISOString(),
      lock_expires_at: lockExpiresAt,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", blueprintId);

  // Conditional claim: either unlocked, expired, or already ours.
  if (current.lockToken && current.lockedByUserId === userId) {
    query = query.eq("lock_token", current.lockToken);
  } else if (current.lockToken) {
    query = query.lt("lock_expires_at", new Date(now).toISOString());
  } else {
    query = query.is("lock_token", null);
  }

  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new BlueprintLockConflictError(current.lockedByUserId);

  return { lockToken, lockExpiresAt };
}

export async function releaseBlueprintLock(
  client: SupabaseClient,
  workspaceId: string,
  blueprintId: string,
  lockToken: string,
): Promise<void> {
  await client
    .from("workforce_blueprints")
    .update({ lock_token: null, locked_by_user_id: null, lock_acquired_at: null, lock_expires_at: null })
    .eq("workspace_id", workspaceId)
    .eq("id", blueprintId)
    .eq("lock_token", lockToken);
}

/** Optimistic-concurrency patch: caller must hold the current lock token and
 * supply the revision they last read (If-Match semantics). On success, bumps
 * revision, writes an append-only revision row, and clears any stale
 * simulation report (draft changed → simulation is no longer valid). */
export async function patchDraftBlueprint(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    blueprintId: string;
    userId: string;
    lockToken: string;
    expectedRevision: number;
    payload: WorkforceBlueprintPayload;
    changeSummary: string;
    name?: string;
  },
): Promise<WorkforceBlueprintRecord> {
  const current = await getBlueprint(client, params.workspaceId, params.blueprintId);
  if (current.lockToken !== params.lockToken) {
    throw new BlueprintLockConflictError(current.lockedByUserId);
  }
  if (current.revision !== params.expectedRevision) {
    throw new BlueprintRevisionConflictError(current.revision);
  }

  const nextRevision = current.revision + 1;
  const { data, error } = await client
    .from("workforce_blueprints")
    .update({
      draft_payload: params.payload,
      revision: nextRevision,
      name: params.name ?? current.name,
      simulation_report: null,
      simulated_at: null,
    })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.blueprintId)
    .eq("revision", params.expectedRevision)
    .eq("lock_token", params.lockToken)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BlueprintRevisionConflictError(current.revision);

  await client.from("workforce_blueprint_revisions").insert({
    blueprint_id: params.blueprintId,
    workspace_id: params.workspaceId,
    revision: nextRevision,
    payload: params.payload,
    change_summary: params.changeSummary,
    changed_by: params.userId,
  });

  return rowToRecord(data as BlueprintRow);
}

export async function saveSimulationReport(
  client: SupabaseClient,
  params: { workspaceId: string; blueprintId: string; revision: number; report: SimulationReport },
): Promise<void> {
  await client
    .from("workforce_blueprints")
    .update({ simulation_report: params.report, simulated_at: params.report.generatedAt })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.blueprintId)
    .eq("revision", params.revision);
}

/** Freeze the draft into an immutable approved snapshot. Requires the caller
 * to hold the lock and be looking at the current revision. The approval hash
 * covers every provisionable/cost-relevant field via canonical serialization. */
export async function approveBlueprint(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    blueprintId: string;
    userId: string;
    lockToken: string;
    expectedRevision: number;
  },
): Promise<WorkforceBlueprintRecord> {
  const current = await getBlueprint(client, params.workspaceId, params.blueprintId);
  if (current.lockToken !== params.lockToken) {
    throw new BlueprintLockConflictError(current.lockedByUserId);
  }
  if (current.revision !== params.expectedRevision) {
    throw new BlueprintRevisionConflictError(current.revision);
  }
  if (current.status !== "draft") {
    throw new Error(`Blueprint is not in a draft state (status=${current.status}).`);
  }

  const approvalHash = canonicalHash({
    templateKey: current.draftPayload.templateKey,
    templateVersion: current.draftPayload.templateVersion,
    seats: current.draftPayload.seats,
    rooms: current.draftPayload.rooms,
    edges: current.draftPayload.edges,
    outcomes: current.draftPayload.outcomes,
  });

  const { data, error } = await client
    .from("workforce_blueprints")
    .update({
      status: "approved",
      approved_payload: current.draftPayload,
      approved_revision: current.revision,
      approval_hash: approvalHash,
      approved_by: params.userId,
      approved_at: new Date().toISOString(),
      lock_token: null,
      locked_by_user_id: null,
      lock_acquired_at: null,
      lock_expires_at: null,
    })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.blueprintId)
    .eq("revision", params.expectedRevision)
    .eq("lock_token", params.lockToken)
    .eq("status", "draft")
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BlueprintRevisionConflictError(current.revision);

  await logEvent(client, {
    workspaceId: params.workspaceId,
    blueprintId: params.blueprintId,
    eventType: "blueprint_approved",
    payload: { approvalHash, revision: current.revision },
    createdBy: params.userId,
  });

  return rowToRecord(data as BlueprintRow);
}

export async function logEvent(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    blueprintId?: string | null;
    planId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  },
): Promise<void> {
  await client.from("workforce_studio_events").insert({
    workspace_id: params.workspaceId,
    blueprint_id: params.blueprintId ?? null,
    plan_id: params.planId ?? null,
    event_type: params.eventType,
    payload: params.payload ?? {},
    created_by: params.createdBy ?? null,
  });
}
