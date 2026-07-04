import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { ensureWorkspaceQuota } from "@/lib/drive/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);
    const quota = await ensureWorkspaceQuota(client, workspaceId);

    return NextResponse.json({ quota });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive quota GET]", error);
    return NextResponse.json({ error: "Unable to load storage quota." }, { status: 500 });
  }
}
