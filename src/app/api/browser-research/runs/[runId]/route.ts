import { NextRequest, NextResponse } from "next/server";
import { getBrowserResearchRun } from "@/lib/ai/browser-research/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const run = await getBrowserResearchRun(client, workspaceId, params.runId);
    if (!run) {
      return NextResponse.json({ error: "Research run not found." }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load research run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
