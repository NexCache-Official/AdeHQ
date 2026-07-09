import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { assignableRoles, canManageMembers } from "@/lib/workspace/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, params.workspaceId, user.id);

    const service = createSupabaseSecretClient();
    const [membersRes, invitesRes] = await Promise.all([
      service
        .from("workspace_members")
        .select("user_id, role, status, joined_at")
        .eq("workspace_id", params.workspaceId)
        .eq("status", "active"),
      service
        .from("workspace_invitations")
        .select("id, invited_email, role, status, created_at")
        .eq("workspace_id", params.workspaceId)
        .eq("status", "pending"),
    ]);
    if (membersRes.error) throw membersRes.error;
    if (invitesRes.error) throw invitesRes.error;

    const userIds = (membersRes.data ?? []).map((m) => m.user_id);
    const profilesRes = userIds.length
      ? await service.from("profiles").select("id, name, email, avatar").in("id", userIds)
      : { data: [], error: null };
    if (profilesRes.error) throw profilesRes.error;
    const profileById = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));

    const members = (membersRes.data ?? []).map((m) => {
      const profile = profileById.get(m.user_id);
      return {
        userId: m.user_id,
        role: m.role,
        joinedAt: m.joined_at,
        name: profile?.name ?? null,
        email: profile?.email ?? null,
        avatar: profile?.avatar ?? null,
      };
    });

    return NextResponse.json({ members, invitations: invitesRes.data ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ members GET]", error);
    return NextResponse.json({ error: "Unable to load members." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canManageMembers(role)) {
      return NextResponse.json({ error: "You cannot manage members." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      targetUserId?: string;
      role?: string;
    };
    if (!body.targetUserId || !body.role) {
      return NextResponse.json({ error: "targetUserId and role are required." }, { status: 400 });
    }
    if (!assignableRoles().includes(body.role as never)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { data: target, error: targetError } = await service
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", params.workspaceId)
      .eq("user_id", body.targetUserId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });
    if (target.role === "owner") {
      return NextResponse.json({ error: "The owner role cannot be changed here." }, { status: 400 });
    }

    const { error: updateError } = await service
      .from("workspace_members")
      .update({ role: body.role })
      .eq("workspace_id", params.workspaceId)
      .eq("user_id", body.targetUserId);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ members PATCH]", error);
    return NextResponse.json({ error: "Unable to update member." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (!canManageMembers(role)) {
      return NextResponse.json({ error: "You cannot manage members." }, { status: 403 });
    }

    const targetUserId = request.nextUrl.searchParams.get("userId");
    if (!targetUserId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }
    if (targetUserId === user.id) {
      return NextResponse.json({ error: "You cannot remove yourself." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { data: target, error: targetError } = await service
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", params.workspaceId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });
    if (target.role === "owner") {
      return NextResponse.json({ error: "The owner cannot be removed." }, { status: 400 });
    }

    const { error: removeError } = await service
      .from("workspace_members")
      .update({ status: "removed" })
      .eq("workspace_id", params.workspaceId)
      .eq("user_id", targetUserId);
    if (removeError) throw removeError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ members DELETE]", error);
    return NextResponse.json({ error: "Unable to remove member." }, { status: 500 });
  }
}
