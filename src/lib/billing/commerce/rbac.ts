import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommerceAdminRole } from "./types";

const ALL_ROLES: CommerceAdminRole[] = [
  "commerce_viewer",
  "support_operator",
  "promotion_manager",
  "billing_operator",
  "catalog_editor",
  "catalog_approver",
  "finance_admin",
  "platform_owner",
];

const ACTION_ROLES: Record<string, CommerceAdminRole[]> = {
  view_catalog: ["commerce_viewer", "platform_owner", "catalog_editor", "catalog_approver", "finance_admin"],
  view_economics: ["commerce_viewer", "finance_admin", "platform_owner"],
  grant_goodwill: ["support_operator", "platform_owner", "finance_admin"],
  manage_promos: ["promotion_manager", "platform_owner"],
  cancel_subscription: ["billing_operator", "platform_owner"],
  repair_subscription: ["billing_operator", "platform_owner"],
  edit_catalog: ["catalog_editor", "catalog_approver", "platform_owner"],
  publish_catalog: ["catalog_approver", "platform_owner"],
  lawful_refund: ["finance_admin", "platform_owner"],
  override_safeguards: ["platform_owner"],
};

export async function getCommerceRoles(
  client: SupabaseClient,
  userId: string,
): Promise<CommerceAdminRole[]> {
  const { data } = await client
    .from("platform_admin_commerce_roles")
    .select("roles")
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.roles && Array.isArray(data.roles) && data.roles.length > 0) {
    return data.roles.filter((r): r is CommerceAdminRole =>
      ALL_ROLES.includes(r as CommerceAdminRole),
    );
  }

  // Existing platform admins default to platform_owner until roles are assigned
  return ["platform_owner"];
}

export async function assertCommerceAction(
  client: SupabaseClient,
  userId: string,
  action: keyof typeof ACTION_ROLES,
): Promise<CommerceAdminRole[]> {
  const roles = await getCommerceRoles(client, userId);
  if (roles.includes("platform_owner")) return roles;
  const allowed = ACTION_ROLES[action] ?? [];
  if (!roles.some((r) => allowed.includes(r))) {
    throw new Error(`Commerce action forbidden: ${action}`);
  }
  return roles;
}

export async function writeCommerceAudit(
  client: SupabaseClient,
  input: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    reason?: string | null;
    ticketRef?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await client.from("commerce_audit_events").insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    reason: input.reason ?? null,
    ticket_ref: input.ticketRef ?? null,
    payload: input.payload ?? {},
  });
}
