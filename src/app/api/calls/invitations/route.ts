import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { acceptInvitation, updateCallState } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  invitationId: z.string().min(1),
  action: z.enum(["accept", "decline"]),
  deviceId: z.string().min(4).max(200),
});

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const now = new Date().toISOString();
    const { data: expired } = await service
      .from("call_invitations")
      .update({ status: "expired", responded_at: now, updated_at: now })
      .eq("workspace_id", workspaceId)
      .eq("invitee_user_id", user.id)
      .eq("status", "pending")
      .lte("expires_at", now)
      .select("call_id");
    for (const invitation of expired ?? []) {
      const { count } = await service
        .from("call_invitations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("call_id", invitation.call_id)
        .in("status", ["pending", "accepted"]);
      if ((count ?? 0) === 0) {
        await service
          .from("call_sessions")
          .update({ status: "missed", ended_at: now, updated_at: now })
          .eq("workspace_id", workspaceId)
          .eq("id", invitation.call_id)
          .eq("status", "ringing");
      }
    }
    const { data, error } = await service
      .from("call_invitations")
      .select("id, call_id, inviter_user_id, status, expires_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("invitee_user_id", user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    return NextResponse.json({ invitations: data ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load invitations." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid invitation response.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const { data: invitation, error } = await service
      .from("call_invitations")
      .select("call_id, invitee_user_id, status")
      .eq("workspace_id", workspaceId)
      .eq("id", parsed.data.invitationId)
      .maybeSingle();
    if (error) throw error;
    if (!invitation || String(invitation.invitee_user_id) !== user.id) {
      throw new AuthError("Invitation not found.", 404);
    }
    if (parsed.data.action === "accept") {
      return NextResponse.json(
        await acceptInvitation(service, {
          workspaceId,
          invitationId: parsed.data.invitationId,
          userId: user.id,
          deviceId: parsed.data.deviceId,
        }),
      );
    }
    if (invitation.status !== "pending") {
      return NextResponse.json({ ok: false, status: invitation.status }, { status: 409 });
    }
    const now = new Date().toISOString();
    await service
      .from("call_invitations")
      .update({ status: "declined", responded_at: now, updated_at: now })
      .eq("workspace_id", workspaceId)
      .eq("id", parsed.data.invitationId)
      .eq("status", "pending");
    await service
      .from("call_participants")
      .update({ state: "declined", updated_at: now })
      .eq("workspace_id", workspaceId)
      .eq("call_id", invitation.call_id)
      .eq("user_id", user.id);
    await updateCallState(service, {
      workspaceId,
      callId: String(invitation.call_id),
      userId: user.id,
      status: "declined",
    });
    return NextResponse.json({ ok: true, status: "declined" });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ call invitation]", error);
    return NextResponse.json({ error: "Could not respond to call." }, { status: 500 });
  }
}
