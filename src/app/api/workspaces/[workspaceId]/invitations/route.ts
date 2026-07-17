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
import {
  consumeRateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

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
      accessPreset?: "full_member" | "standard_member" | "restricted_member";
      accessPackage?: Record<string, unknown>;
      aiGrants?: Array<{
        employeeId: string;
        accessEffect?: "allow" | "deny";
        canDm?: boolean;
      }>;
      roomGrants?: string[];
      topicDenies?: string[];
    };
    const invitedEmail = body.email?.trim().toLowerCase();
    const invitedRole = normalizeWorkspaceRole(body.role?.trim() || "member");
    const accessPreset = body.accessPreset ?? "full_member";
    const validPresets = new Set(["full_member", "standard_member", "restricted_member"]);

    if (!invitedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invitedEmail)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!VALID_ROLES.has(invitedRole)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    if (!validPresets.has(accessPreset)) {
      return NextResponse.json({ error: "Invalid access preset." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const inviteLimit = await consumeRateLimit(service, {
      bucket: "workspace.invitations.admin.day",
      key: `${params.workspaceId}:${user.id}`,
      limit: 20,
      windowMs: 24 * 60 * 60_000,
    });
    if (!inviteLimit.allowed) {
      return rateLimitResponse(inviteLimit, "Daily workspace invitation limit reached.");
    }
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

    const invitePayload = {
      workspace_id: params.workspaceId,
      invited_email: invitedEmail,
      invited_by: user.id,
      role: invitedRole,
      status: "pending" as const,
      accepted_by: null,
      accepted_at: null,
      expires_at: expiresAt,
      access_preset: accessPreset,
      access_package: body.accessPackage ?? { preset: accessPreset },
    };

    const { data: invite, error: inviteError } = await service
      .from("workspace_invitations")
      .upsert(invitePayload, { onConflict: "workspace_id,invited_email" })
      .select("*")
      .single();

    let savedInvite = invite;
    if (inviteError || !savedInvite) {
      const { data: inserted, error: insertError } = await service
        .from("workspace_invitations")
        .insert({
          workspace_id: params.workspaceId,
          invited_email: invitedEmail,
          invited_by: user.id,
          role: invitedRole,
          status: "pending",
          expires_at: expiresAt,
          access_preset: accessPreset,
          access_package: body.accessPackage ?? { preset: accessPreset },
        })
        .select("*")
        .single();
      if (insertError) throw insertError;
      savedInvite = inserted;
    }

    const inviteId = String(savedInvite.id);

    // Replace package grant rows for this invite
    await service.from("invite_ai_employee_grants").delete().eq("invite_id", inviteId);
    await service.from("invite_room_grants").delete().eq("invite_id", inviteId);
    await service.from("invite_topic_grants").delete().eq("invite_id", inviteId);

    if (body.aiGrants?.length) {
      const { error } = await service.from("invite_ai_employee_grants").insert(
        body.aiGrants.map((g) => ({
          invite_id: inviteId,
          employee_id: g.employeeId,
          access_effect: g.accessEffect === "deny" ? "deny" : "allow",
          can_dm: g.canDm !== false,
        })),
      );
      if (error) throw error;
    }

    if (body.roomGrants?.length) {
      const { error } = await service.from("invite_room_grants").insert(
        body.roomGrants.map((roomId) => ({ invite_id: inviteId, room_id: roomId })),
      );
      if (error) throw error;
    }

    if (body.topicDenies?.length) {
      const { error } = await service.from("invite_topic_grants").insert(
        body.topicDenies.map((topicId) => ({
          invite_id: inviteId,
          topic_id: topicId,
          access: "denied",
        })),
      );
      if (error) throw error;
    }

    await sendInviteEmail(
      service,
      params.workspaceId,
      invitedEmail,
      invitedRole,
      user,
      String(savedInvite.token),
    );
    return NextResponse.json({ ok: true, invitation: savedInvite });
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
