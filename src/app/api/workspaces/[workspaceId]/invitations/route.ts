import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { canManageMembers } from "@/lib/workspace/permissions";
import { sendEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["admin", "manager", "member", "viewer"]);

/**
 * Create a workspace invitation and send the branded invite email.
 * Authorizes the caller via workspace membership + canManageMembers, inserts
 * the pending invite with the secret-key client, then emails the invitee.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canManageMembers(role)) {
      return NextResponse.json(
        { error: "Only workspace owners and admins can invite members." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      role?: string;
    };
    const invitedEmail = body.email?.trim().toLowerCase();
    const invitedRole = body.role?.trim() || "member";

    if (!invitedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitedEmail)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!VALID_ROLES.has(invitedRole)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();

    // Insert (or refresh) the pending invite.
    const { data: invite, error: inviteError } = await service
      .from("workspace_invitations")
      .upsert(
        {
          workspace_id: params.workspaceId,
          invited_email: invitedEmail,
          invited_by: user.id,
          role: invitedRole,
          status: "pending",
        },
        { onConflict: "workspace_id,invited_email" },
      )
      .select("*")
      .single();

    if (inviteError) {
      // Table may not have a unique constraint for upsert — fall back to insert.
      const { data: inserted, error: insertError } = await service
        .from("workspace_invitations")
        .insert({
          workspace_id: params.workspaceId,
          invited_email: invitedEmail,
          invited_by: user.id,
          role: invitedRole,
          status: "pending",
        })
        .select("*")
        .single();
      if (insertError) throw insertError;
      await sendInviteEmail(service, params.workspaceId, invitedEmail, invitedRole, user);
      return NextResponse.json({ ok: true, invitation: inserted });
    }

    await sendInviteEmail(service, params.workspaceId, invitedEmail, invitedRole, user);
    return NextResponse.json({ ok: true, invitation: invite });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ workspace invitation]", error);
    return NextResponse.json({ error: "Unable to create invitation." }, { status: 500 });
  }
}

async function sendInviteEmail(
  service: ReturnType<typeof createSupabaseSecretClient>,
  workspaceId: string,
  invitedEmail: string,
  role: string,
  inviter: { email?: string; user_metadata?: Record<string, unknown> },
) {
  const { data: workspace } = await service
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();

  const inviterName =
    (inviter.user_metadata?.full_name as string | undefined) ||
    (inviter.user_metadata?.name as string | undefined) ||
    inviter.email ||
    undefined;

  await sendEmail({
    template: "workspace_invite",
    to: invitedEmail,
    workspaceId,
    props: {
      actionUrl: `${getSiteUrl()}/login?next=/onboarding`,
      workspaceName: (workspace?.name as string | undefined) || "an AdeHQ workspace",
      inviterName,
      role,
    },
    client: service,
  });
}
