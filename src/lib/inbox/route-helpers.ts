/**
 * Shared plumbing for Slice B inbox API routes: authenticate, resolve the
 * workspace's primary mailbox, and gate on mailbox-specific access.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getPrimaryMailbox } from "./mailbox";
import { requireInboxAccess, type InboxAccess, type InboxAction } from "./access";
import type { MailboxDTO } from "./types";

export type InboxRouteContext = {
  user: User;
  secret: SupabaseClient;
  workspaceId: string;
  mailbox: MailboxDTO;
  access: InboxAccess;
};

/**
 * Authenticate, resolve the primary mailbox, and require `action` access.
 * Throws AuthError (401/403) or a 404-flagged error when no mailbox is claimed.
 */
export async function resolveInboxRoute(
  request: NextRequest,
  workspaceId: string | undefined,
  action: InboxAction,
): Promise<InboxRouteContext> {
  const { user } = await requireAuthUser(request);
  if (!workspaceId) {
    throw new AuthError("workspaceId required", 400);
  }
  const secret = createSupabaseSecretClient();
  const mailbox = await getPrimaryMailbox(secret, workspaceId);
  if (!mailbox) {
    throw new AuthError("No mailbox has been claimed for this workspace.", 404);
  }
  const access = await requireInboxAccess(secret, {
    workspaceId,
    mailboxId: mailbox.id,
    userId: user.id,
    action,
  });
  return { user, secret, workspaceId, mailbox, access };
}

export function inboxErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Request failed";
  console.error("[inbox] route error", error);
  return NextResponse.json({ error: message }, { status: 500 });
}
