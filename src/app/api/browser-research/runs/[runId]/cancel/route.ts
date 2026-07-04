import { NextRequest, NextResponse } from "next/server";
import { cancelBrowserResearchRun } from "@/lib/ai/browser-research/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string; reason?: string };
    const workspaceId = body.workspaceId?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const serviceClient = createServiceRoleClient();
    const run = await cancelBrowserResearchRun(
      serviceClient,
      workspaceId,
      params.runId,
      body.reason?.trim() || "Cancelled by user.",
    );

    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to cancel research run.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
