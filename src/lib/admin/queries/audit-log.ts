import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLogEntry } from "../types";

export async function listAuditLogs(
  client: SupabaseClient,
  options: { action?: string | null; limit?: number } = {},
): Promise<AuditLogEntry[]> {
  let query = client
    .from("platform_admin_audit_logs")
    .select("id, admin_user_id, action, target_type, target_id, before, after, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (options.action?.trim()) {
    query = query.eq("action", options.action.trim());
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const adminIds = [...new Set(rows.map((row) => row.admin_user_id))];
  const adminsRes = adminIds.length
    ? await client.from("platform_admins").select("user_id, email").in("user_id", adminIds)
    : { data: [], error: null };
  if (adminsRes.error) throw adminsRes.error;
  const emailById = new Map((adminsRes.data ?? []).map((a) => [a.user_id, a.email]));

  return rows.map((row) => ({
    id: row.id,
    adminUserId: row.admin_user_id,
    adminEmail: emailById.get(row.admin_user_id),
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before,
    after: row.after,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
