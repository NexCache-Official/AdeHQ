import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { listCalendarWorkspaceData } from "@/lib/server/calendar-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
    const query = request.nextUrl.searchParams.get("q") ?? undefined;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    const payload = await listCalendarWorkspaceData(client, workspaceId, { query });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ calendar GET]", error);
    return NextResponse.json({ error: "Unable to load calendar." }, { status: 500 });
  }
}
