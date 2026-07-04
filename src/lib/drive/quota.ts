import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriveFolder, WorkspaceStorageQuota } from "@/lib/types";
import {
  FREE_TIER_MAX_FILE_BYTES,
  FREE_TIER_MAX_WORKSPACE_BYTES,
} from "@/lib/drive/constants";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export function driveFolderFromRow(row: DbRow): DriveFolder {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name),
    section: row.section as DriveFolder["section"],
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

export function workspaceQuotaFromRow(row: DbRow): WorkspaceStorageQuota {
  return {
    workspaceId: String(row.workspace_id),
    planTier: row.plan_tier as WorkspaceStorageQuota["planTier"],
    maxWorkspaceBytes: Number(row.max_workspace_bytes ?? FREE_TIER_MAX_WORKSPACE_BYTES),
    maxFileBytes: Number(row.max_file_bytes ?? FREE_TIER_MAX_FILE_BYTES),
    usedBytes: Number(row.used_bytes ?? 0),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

export async function ensureWorkspaceQuota(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceStorageQuota> {
  const { data: existing, error: findError } = await client
    .from("workspace_storage_quotas")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return workspaceQuotaFromRow(existing as DbRow);

  const { data: created, error: createError } = await client
    .from("workspace_storage_quotas")
    .insert({
      workspace_id: workspaceId,
      plan_tier: "free",
      max_workspace_bytes: FREE_TIER_MAX_WORKSPACE_BYTES,
      max_file_bytes: FREE_TIER_MAX_FILE_BYTES,
      used_bytes: 0,
    })
    .select("*")
    .single();
  if (createError) throw createError;
  return workspaceQuotaFromRow(created as DbRow);
}

export type QuotaCheckResult =
  | { ok: true; quota: WorkspaceStorageQuota }
  | { ok: false; error: string; quota: WorkspaceStorageQuota };

export async function checkUploadQuota(
  client: SupabaseClient,
  workspaceId: string,
  fileSizeBytes: number,
): Promise<QuotaCheckResult> {
  const quota = await ensureWorkspaceQuota(client, workspaceId);

  if (fileSizeBytes > quota.maxFileBytes) {
    return {
      ok: false,
      quota,
      error: `This file exceeds your ${formatLimit(quota.maxFileBytes)} per-file limit.`,
    };
  }

  if (quota.usedBytes + fileSizeBytes > quota.maxWorkspaceBytes) {
    return {
      ok: false,
      quota,
      error: `Upload would exceed your workspace storage limit (${formatLimit(quota.maxWorkspaceBytes)}).`,
    };
  }

  return { ok: true, quota };
}

function formatLimit(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export async function recordStorageUsage(
  client: SupabaseClient,
  payload: {
    workspaceId: string;
    userId?: string | null;
    eventType: "upload" | "delete" | "export" | "artifact_save" | "adjustment";
    bucket: string;
    objectPath?: string | null;
    sizeBytes: number;
    deltaBytes: number;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<WorkspaceStorageQuota> {
  const quota = await ensureWorkspaceQuota(client, payload.workspaceId);
  const nextUsed = Math.max(0, quota.usedBytes + payload.deltaBytes);

  const [{ error: eventError }, { error: quotaError }] = await Promise.all([
    client.from("storage_usage_events").insert({
      workspace_id: payload.workspaceId,
      user_id: payload.userId ?? null,
      event_type: payload.eventType,
      bucket: payload.bucket,
      object_path: payload.objectPath ?? null,
      size_bytes: payload.sizeBytes,
      delta_bytes: payload.deltaBytes,
      entity_type: payload.entityType ?? null,
      entity_id: payload.entityId ?? null,
      metadata: payload.metadata ?? {},
    }),
    client
      .from("workspace_storage_quotas")
      .update({ used_bytes: nextUsed, updated_at: nowISO() })
      .eq("workspace_id", payload.workspaceId),
  ]);

  if (eventError) throw eventError;
  if (quotaError) throw quotaError;

  return { ...quota, usedBytes: nextUsed, updatedAt: nowISO() };
}

export async function recalculateWorkspaceUsage(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceStorageQuota> {
  const quota = await ensureWorkspaceQuota(client, workspaceId);

  const [filesResult, evidenceResult, exportsResult] = await Promise.all([
    client
      .from("workspace_files")
      .select("size_bytes")
      .eq("workspace_id", workspaceId)
      .in("status", ["ready", "uploaded", "processing"]),
    client.from("browser_evidence").select("size_bytes").eq("workspace_id", workspaceId),
    client.from("drive_exports").select("size_bytes").eq("workspace_id", workspaceId),
  ]);

  if (filesResult.error) throw filesResult.error;
  if (evidenceResult.error) throw evidenceResult.error;
  if (exportsResult.error) throw exportsResult.error;

  const sum = (rows: Array<{ size_bytes?: number }> | null) =>
    (rows ?? []).reduce((acc, row) => acc + Number(row.size_bytes ?? 0), 0);

  const usedBytes = sum(filesResult.data as Array<{ size_bytes?: number }>)
    + sum(evidenceResult.data as Array<{ size_bytes?: number }>)
    + sum(exportsResult.data as Array<{ size_bytes?: number }>);

  const { error } = await client
    .from("workspace_storage_quotas")
    .update({ used_bytes: usedBytes, updated_at: nowISO() })
    .eq("workspace_id", workspaceId);
  if (error) throw error;

  return { ...quota, usedBytes, updatedAt: nowISO() };
}
