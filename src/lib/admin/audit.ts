import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export type AuditSeverity = "info" | "low" | "medium" | "high" | "critical";

export type AuditActionMeta = {
  severity: AuditSeverity;
  requiresReason?: boolean;
};

/** Known admin actions and their audit severity. */
export const AUDIT_ACTION_META: Record<string, AuditActionMeta> = {
  feature_flag_updated: { severity: "medium" },
  maintenance_toggle_changed: { severity: "critical", requiresReason: true },
  maintenance_message_updated: { severity: "low" },
  model_pricing_synced: { severity: "low" },
  model_endpoint_enabled: { severity: "high", requiresReason: true },
  model_endpoint_disabled: { severity: "high", requiresReason: true },
  workspace_status_changed: { severity: "high", requiresReason: true },
  workspace_plan_changed: { severity: "medium" },
  workspace_work_hours_granted: { severity: "medium", requiresReason: true },
  workspace_plan_override_set: { severity: "high", requiresReason: true },
  workspace_plan_override_cleared: { severity: "medium", requiresReason: true },
  workspace_subscription_status_changed: { severity: "high", requiresReason: true },
  plan_config_updated: { severity: "medium" },
  plan_config_created: { severity: "medium" },
  promo_code_created: { severity: "medium" },
  promo_code_updated: { severity: "medium" },
  vercel_env_created: { severity: "critical", requiresReason: true },
  vercel_env_updated: { severity: "critical", requiresReason: true },
  vercel_env_deleted: { severity: "critical", requiresReason: true },
  user_disabled: { severity: "high", requiresReason: true },
  user_enabled: { severity: "medium" },
  viewed_support_metadata: { severity: "critical", requiresReason: true },
  viewed_restricted_content: { severity: "critical", requiresReason: true },
};

export type AuditLogInput = {
  adminUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  severity?: AuditSeverity;
  request?: NextRequest;
  requestId?: string;
  sessionId?: string;
};

export async function writeAuditLog(
  serviceClient: SupabaseClient,
  input: AuditLogInput,
): Promise<void> {
  const meta = AUDIT_ACTION_META[input.action];
  const severity = input.severity ?? meta?.severity ?? "info";
  const requiresReason = meta?.requiresReason ?? false;

  if (requiresReason && !input.reason?.trim()) {
    console.warn(
      `[AdeHQ Control] audit action ${input.action} should include a reason`,
    );
  }

  const { error } = await serviceClient.from("platform_admin_audit_logs").insert({
    admin_user_id: input.adminUserId,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    severity,
    requires_reason: requiresReason,
    request_id: input.requestId ?? input.request?.headers.get("x-request-id") ?? null,
    session_id: input.sessionId ?? null,
    ip_address:
      input.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: input.request?.headers.get("user-agent") ?? null,
  });

  if (error) {
    console.error("[AdeHQ Control] audit log write failed:", error.message, input.action);
  }
}
