import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { writeAuditLog } from "./audit";
import type { AdminPrivacyLevel } from "./privacy";

const SUPPORT_SESSION_HOURS = 2;

export async function openSupportSession(
  serviceClient: SupabaseClient,
  adminUserId: string,
  reason: string,
): Promise<string> {
  const expiresAt = new Date(Date.now() + SUPPORT_SESSION_HOURS * 60 * 60 * 1000);
  const { data, error } = await serviceClient
    .from("platform_admin_sessions")
    .insert({
      admin_user_id: adminUserId,
      reason: reason.trim(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function logRestrictedAccess(
  serviceClient: SupabaseClient,
  input: {
    adminUserId: string;
    sessionId?: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    privacyLevel: AdminPrivacyLevel;
    request?: NextRequest;
  },
): Promise<void> {
  await serviceClient.from("platform_support_access_logs").insert({
    admin_user_id: input.adminUserId,
    session_id: input.sessionId ?? null,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
  });

  await writeAuditLog(serviceClient, {
    adminUserId: input.adminUserId,
    action:
      input.privacyLevel === "restricted_content"
        ? "viewed_restricted_content"
        : "viewed_support_metadata",
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    sessionId: input.sessionId,
    request: input.request,
  });
}
