import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { ensureMemberAccessFromGrants } from "@/lib/server/apply-invite-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Repair path: ensure room_user_state for workspace-visible rooms for the caller.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const workspaceId = body.workspaceId?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    await ensureMemberAccessFromGrants(service, workspaceId, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ensure-member-access]", error);
    return NextResponse.json({ error: "Unable to repair member access." }, { status: 500 });
  }
}
