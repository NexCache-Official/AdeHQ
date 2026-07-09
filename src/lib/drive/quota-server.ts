import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedWorkspacePlan } from "@/lib/billing/plans/types";
import { resolveWorkspacePlan } from "@/lib/billing/plans/resolve-workspace-plan";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  checkUploadQuota as checkUploadQuotaWithClient,
  recordStorageUsage as recordStorageUsageWithClient,
  recalculateWorkspaceUsage as recalculateWorkspaceUsageWithClient,
  workspaceQuotaFromRow,
  type QuotaCheckResult,
} from "@/lib/drive/quota";
import type { WorkspaceStorageQuota } from "@/lib/types";
import {
  FREE_TIER_MAX_FILE_BYTES,
  FREE_TIER_MAX_WORKSPACE_BYTES,
} from "@/lib/drive/constants";

/** Practical cap when a plan marks storage as unlimited (enterprise). */
export const UNLIMITED_STORAGE_BYTES = 1024 ** 4;

function getAdminClient(): SupabaseClient {
  return createSupabaseSecretClient();
}

export function storageLimitsFromPlan(plan: ResolvedWorkspacePlan): {
  planTier: string;
  maxWorkspaceBytes: number;
  maxFileBytes: number;
} {
  const rawStorage = plan.config.maxStorageBytes;
  const maxWorkspaceBytes =
    rawStorage == null || rawStorage <= 0 ? UNLIMITED_STORAGE_BYTES : rawStorage;
  const maxFileMb = plan.config.maxFileUploadMb ?? 10;
  return {
    planTier: plan.planSlug,
    maxWorkspaceBytes,
    maxFileBytes: maxFileMb * 1024 * 1024,
  };
}

async function syncQuotaLimits(
  client: SupabaseClient,
  workspaceId: string,
): Promise<{ planTier: string; maxWorkspaceBytes: number; maxFileBytes: number }> {
  try {
    const plan = await resolveWorkspacePlan(client, workspaceId);
    return storageLimitsFromPlan(plan);
  } catch (error) {
    console.warn("[AdeHQ drive quota] plan sync failed, using defaults", error);
    return {
      planTier: "free",
      maxWorkspaceBytes: FREE_TIER_MAX_WORKSPACE_BYTES,
      maxFileBytes: FREE_TIER_MAX_FILE_BYTES,
    };
  }
}

/** Server-side quota ensure — uses the Supabase secret key and syncs limits from the commercial plan. */
export async function ensureWorkspaceQuota(workspaceId: string): Promise<WorkspaceStorageQuota> {
  const client = getAdminClient();
  const limits = await syncQuotaLimits(client, workspaceId);

  const { data: existing, error: findError } = await client
    .from("workspace_storage_quotas")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (findError) throw findError;

  if (!existing) {
    const { data: created, error: createError } = await client
      .from("workspace_storage_quotas")
      .insert({
        workspace_id: workspaceId,
        plan_tier: limits.planTier,
        max_workspace_bytes: limits.maxWorkspaceBytes,
        max_file_bytes: limits.maxFileBytes,
        used_bytes: 0,
      })
      .select("*")
      .single();
    if (createError) throw createError;
    return workspaceQuotaFromRow(created as Record<string, unknown>);
  }

  const needsSync =
    String(existing.plan_tier) !== limits.planTier ||
    Number(existing.max_workspace_bytes) !== limits.maxWorkspaceBytes ||
    Number(existing.max_file_bytes) !== limits.maxFileBytes;

  if (!needsSync) {
    return workspaceQuotaFromRow(existing as Record<string, unknown>);
  }

  const { data: updated, error: updateError } = await client
    .from("workspace_storage_quotas")
    .update({
      plan_tier: limits.planTier,
      max_workspace_bytes: limits.maxWorkspaceBytes,
      max_file_bytes: limits.maxFileBytes,
    })
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return workspaceQuotaFromRow(updated as Record<string, unknown>);
}

export async function checkUploadQuota(
  workspaceId: string,
  fileSizeBytes: number,
): Promise<QuotaCheckResult> {
  const client = getAdminClient();
  await ensureWorkspaceQuota(workspaceId);
  return checkUploadQuotaWithClient(client, workspaceId, fileSizeBytes);
}

export async function recordStorageUsage(payload: {
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
}): Promise<WorkspaceStorageQuota> {
  const client = getAdminClient();
  await ensureWorkspaceQuota(payload.workspaceId);
  return recordStorageUsageWithClient(client, payload);
}

export async function recalculateWorkspaceUsage(workspaceId: string): Promise<WorkspaceStorageQuota> {
  const client = getAdminClient();
  await ensureWorkspaceQuota(workspaceId);
  return recalculateWorkspaceUsageWithClient(client, workspaceId);
}
