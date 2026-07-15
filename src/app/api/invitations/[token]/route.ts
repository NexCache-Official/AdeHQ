import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { normalizeWorkspaceRole, roleLabel } from "@/lib/workspace/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public invite preview (no secrets beyond what the link holder already has). */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  try {
    const token = params.token?.trim();
    if (!token) {
      return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { data: invite, error } = await service
      .from("workspace_invitations")
      .select("workspace_id, invited_email, role, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (error) throw error;
    if (!invite) {
      return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    }

    const expired =
      Boolean(invite.expires_at) && new Date(String(invite.expires_at)).getTime() < Date.now();

    const { data: workspace } = await service
      .from("workspaces")
      .select("id, name")
      .eq("id", invite.workspace_id)
      .maybeSingle();

    const role = normalizeWorkspaceRole(String(invite.role));

    return NextResponse.json({
      workspaceId: invite.workspace_id,
      workspaceName: workspace?.name ?? "AdeHQ workspace",
      role,
      roleLabel: roleLabel(role),
      invitedEmail: invite.invited_email,
      status: invite.status,
      expired,
    });
  } catch (error) {
    console.error("[AdeHQ invitation preview]", error);
    return NextResponse.json({ error: "Unable to load invitation." }, { status: 500 });
  }
}
