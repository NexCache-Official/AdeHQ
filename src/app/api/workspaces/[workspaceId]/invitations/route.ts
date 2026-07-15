import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { canManageMembers, normalizeWorkspaceRole } from "@/lib/workspace/permissions";
import { sendEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["admin", "member"]);

/**
 * Create a workspace invitation and send the branded invite email.
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
        { error: "Only workspace admins can invite members." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      role?: string;
    };
    const invitedEmail = body.email?.trim().toLowerCase();
    const invitedRole = normalizeWorkspaceRole(body.role?.trim() || "member");

    if (!invitedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitedEmail)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!VALID_ROLES.has(invitedRole)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();

    const { data: invite, error: inviteError } = await service
      .from("workspace_invitations")
      .upsert(
        {
          workspace_id: params.workspaceId,
          invited_email: invitedEmail,
          invited_by: user.id,
          role: invitedRole,
          status: "pending",
          accepted_by: null,
          accepted_at: null,
        },
        { onConflict: "workspace_id,invited_email" },
      )
      .select("*")
      .single();

    if (inviteError) {
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
      await sendInviteEmail(service, params.workspaceId, invitedEmail, invitedRole, user, String(inserted.token));
      return NextResponse.json({ ok: true, invitation: inserted });
    }

    await sendInviteEmail(service, params.workspaceId, invitedEmail, invitedRole, user, String(invite.token));
    return NextResponse.json({ ok: true, invitation: invite });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ workspace invitation]", error);
    return NextResponse.json({ error: "Unable to create invitation." }, { status: 500 });
  }
}

/** Revoke a pending invitation. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canManageMembers(role)) {
      return NextResponse.json(
        { error: "Only workspace admins can revoke invitations." },
        { status: 403 },
      );
    }

    const invitationId =
      request.nextUrl.searchParams.get("invitationId") ??
      ((await request.json().catch(() => ({}))) as { invitationId?: string }).invitationId;

    if (!invitationId) {
      return NextResponse.json({ error: "Missing invitationId." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { error } = await service
      .from("workspace_invitations")
      .update({ status: "revoked" })
      .eq("id", invitationId)
      .eq("workspace_id", params.workspaceId)
      .eq("status", "pending");
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ workspace invitation revoke]", error);
    return NextResponse.json({ error: "Unable to revoke invitation." }, { status: 500 });
  }
}

async function sendInviteEmail(
  service: ReturnType<typeof createSupabaseSecretClient>,
  workspaceId: string,
  invitedEmail: string,
  role: string,
  inviter: { email?: string; user_metadata?: Record<string, unknown> },
  token: string,
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
      actionUrl: `${getSiteUrl()}/invite/${token}`,
      workspaceName: (workspace?.name as string | undefined) || "an AdeHQ workspace",
      inviterName,
      role,
    },
    client: service,
  });
}
