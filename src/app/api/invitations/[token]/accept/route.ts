import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { normalizeWorkspaceRole } from "@/lib/workspace/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } },
) {
  try {
    const { user } = await requireAuthUser(request);
    const token = params.token?.trim();
    if (!token) {
      return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });
    }

    const userEmail = user.email?.trim().toLowerCase();
    if (!userEmail) {
      return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { data: invite, error } = await service
      .from("workspace_invitations")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error) throw error;
    if (!invite) {
      return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    }

    if (invite.status !== "pending") {
      return NextResponse.json(
        { error: `This invitation is ${invite.status}.` },
        { status: 409 },
      );
    }

    if (invite.expires_at && new Date(String(invite.expires_at)).getTime() < Date.now()) {
      await service
        .from("workspace_invitations")
        .update({ status: "expired" })
        .eq("id", invite.id);
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }

    if (String(invite.invited_email).trim().toLowerCase() !== userEmail) {
      return NextResponse.json(
        { error: "Sign in with the email address this invitation was sent to." },
        { status: 403 },
      );
    }

    const role = normalizeWorkspaceRole(String(invite.role));
    const now = new Date().toISOString();

    const { error: memberError } = await service.from("workspace_members").upsert(
      {
        workspace_id: invite.workspace_id,
        user_id: user.id,
        role,
        status: "active",
        joined_at: now,
      },
      { onConflict: "workspace_id,user_id" },
    );
    if (memberError) throw memberError;

    const { error: inviteError } = await service
      .from("workspace_invitations")
      .update({
        status: "accepted",
        accepted_by: user.id,
        accepted_at: now,
      })
      .eq("id", invite.id)
      .eq("status", "pending");
    if (inviteError) throw inviteError;

    const { data: workspace } = await service
      .from("workspaces")
      .select("name")
      .eq("id", invite.workspace_id)
      .maybeSingle();

    return NextResponse.json({
      workspaceId: invite.workspace_id,
      workspaceName: workspace?.name ?? "workspace",
      role,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ invitation accept]", error);
    return NextResponse.json({ error: "Unable to accept invitation." }, { status: 500 });
  }
}
