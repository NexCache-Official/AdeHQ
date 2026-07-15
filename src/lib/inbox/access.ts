/**
 * Mailbox-specific permission checks (Slice B).
 *
 * Inbox access is NOT plain workspace membership. Owners/admins are implicitly
 * authorised for everything; managers/members get read/send/organize/manage only
 * through an explicit `email_mailbox_access` grant; guests get nothing.
 *
 * These checks run in the API layer against the secret (service-role) client, so
 * all inbox DB operations happen after an explicit gate. The restrictive RLS
 * policies added in the Slice B migration are defence-in-depth for the browser's
 * authed client (realtime).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";

export type InboxAction =
  | "read"
  | "send"
  | "organize"
  | "manage"
  | "approve"
  | "compose"
  | "assign"
  | "create_ai_draft"
  | "approve_ai_send"
  | "manage_mailbox";

/** Plan-facing permission names mapped onto mailbox grants. */
export type EmailPermission =
  | "email.read"
  | "email.compose"
  | "email.send"
  | "email.assign"
  | "email.create_ai_draft"
  | "email.approve_ai_send"
  | "email.manage_mailbox"
  | "email.manage_rules";

export type InboxAccess = {
  role: string;
  isAdmin: boolean;
  canRead: boolean;
  canSend: boolean;
  canOrganize: boolean;
  canManage: boolean;
  canApprove: boolean;
  /** Granular aliases (same underlying grants). */
  permissions: EmailPermission[];
};

const NO_ACCESS: Omit<InboxAccess, "role"> = {
  isAdmin: false,
  canRead: false,
  canSend: false,
  canOrganize: false,
  canManage: false,
  canApprove: false,
  permissions: [],
};

function buildPermissions(flags: {
  canRead: boolean;
  canSend: boolean;
  canOrganize: boolean;
  canManage: boolean;
  canApprove: boolean;
}): EmailPermission[] {
  const list: EmailPermission[] = [];
  if (flags.canRead) list.push("email.read");
  if (flags.canSend) {
    list.push("email.compose", "email.send", "email.create_ai_draft");
  }
  if (flags.canOrganize) list.push("email.assign");
  if (flags.canApprove) list.push("email.approve_ai_send");
  if (flags.canManage) {
    list.push("email.manage_mailbox", "email.manage_rules");
  }
  return list;
}

/**
 * Resolve a user's effective access to a specific mailbox. Uses the secret
 * client so it can read membership + grants regardless of RLS.
 */
export async function getInboxAccess(
  secret: SupabaseClient,
  params: { workspaceId: string; mailboxId: string; userId: string },
): Promise<InboxAccess> {
  const { data: member, error: memberError } = await secret
    .from("workspace_members")
    .select("role, status")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (memberError) throw memberError;

  if (!member || member.status !== "active") {
    return { role: "none", ...NO_ACCESS };
  }

  const role = String(member.role);

  if (role === "admin" || role === "owner") {
    const flags = {
      canRead: true,
      canSend: true,
      canOrganize: true,
      canManage: true,
      canApprove: true,
    };
    return {
      role,
      isAdmin: true,
      ...flags,
      permissions: buildPermissions(flags),
    };
  }

  if (role === "member" || role === "manager") {
    const { data: grant, error: grantError } = await secret
      .from("email_mailbox_access")
      .select("can_read, can_send, can_manage")
      .eq("mailbox_id", params.mailboxId)
      .eq("user_id", params.userId)
      .maybeSingle();
    if (grantError) throw grantError;

    const canRead = Boolean(grant?.can_read);
    const canSend = Boolean(grant?.can_send);
    const canManage = Boolean(grant?.can_manage);
    const canOrganize = canManage || canRead;
    const canApprove = canManage;
    const flags = { canRead, canSend, canOrganize, canManage, canApprove };

    return { role, isAdmin: false, ...flags, permissions: buildPermissions(flags) };
  }

  return { role, ...NO_ACCESS };
}

function actionAllowed(access: InboxAccess, action: InboxAction): boolean {
  switch (action) {
    case "read":
    case "compose":
      return action === "read" ? access.canRead : access.canSend;
    case "send":
    case "create_ai_draft":
      return access.canSend;
    case "organize":
    case "assign":
      return access.canOrganize;
    case "manage":
    case "manage_mailbox":
      return access.canManage;
    case "approve":
    case "approve_ai_send":
      return access.canApprove;
    default:
      return false;
  }
}

/**
 * Throw a typed AuthError unless the user may perform `action` on the mailbox.
 * Returns the resolved access on success so callers can reuse the flags.
 */
export async function requireInboxAccess(
  secret: SupabaseClient,
  params: { workspaceId: string; mailboxId: string; userId: string; action: InboxAction },
): Promise<InboxAccess> {
  const access = await getInboxAccess(secret, params);
  if (!actionAllowed(access, params.action)) {
    throw new AuthError("You do not have access to this mailbox.", 403);
  }
  return access;
}

/** Owner/admin gate for claim + mailbox settings. */
export async function requireWorkspaceAdmin(
  secret: SupabaseClient,
  params: { workspaceId: string; userId: string },
): Promise<{ role: string }> {
  const { data, error } = await secret
    .from("workspace_members")
    .select("role, status")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active" || !["admin", "owner"].includes(String(data.role))) {
    throw new AuthError("Only workspace admins can perform this action.", 403);
  }
  return { role: String(data.role) };
}
