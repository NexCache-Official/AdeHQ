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

export type InboxAction = "read" | "send" | "organize" | "manage" | "approve";

export type InboxAccess = {
  role: string;
  isAdmin: boolean;
  canRead: boolean;
  canSend: boolean;
  canOrganize: boolean;
  canManage: boolean;
  canApprove: boolean;
};

const NO_ACCESS: Omit<InboxAccess, "role"> = {
  isAdmin: false,
  canRead: false,
  canSend: false,
  canOrganize: false,
  canManage: false,
  canApprove: false,
};

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

  if (role === "owner" || role === "admin") {
    return {
      role,
      isAdmin: true,
      canRead: true,
      canSend: true,
      canOrganize: true,
      canManage: true,
      canApprove: true,
    };
  }

  if (role === "manager" || role === "member") {
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
    // Managers may organize (archive / spam) any mailbox they can read.
    const canOrganize = canManage || (role === "manager" && canRead);
    // Approvers: manage grant or managers who can read.
    const canApprove = canManage || (role === "manager" && canRead);

    return { role, isAdmin: false, canRead, canSend, canOrganize, canManage, canApprove };
  }

  // guest and anything else
  return { role, ...NO_ACCESS };
}

function actionAllowed(access: InboxAccess, action: InboxAction): boolean {
  switch (action) {
    case "read":
      return access.canRead;
    case "send":
      return access.canSend;
    case "organize":
      return access.canOrganize;
    case "manage":
      return access.canManage;
    case "approve":
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
  if (!data || data.status !== "active" || !["owner", "admin"].includes(String(data.role))) {
    throw new AuthError("Only workspace owners and admins can perform this action.", 403);
  }
  return { role: String(data.role) };
}
