import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { summarizeWorkspaceWorkMinutes } from "@/lib/ai/work-hours/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const weekStart = request.nextUrl.searchParams.get("weekStart")?.trim() || undefined;
    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const summary = await summarizeWorkspaceWorkMinutes(client, workspaceId, { weekStart });
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ work-hours shadow GET]", error);
    return NextResponse.json({ error: "Unable to load shadow Work Hours summary." }, { status: 500 });
  }
}
