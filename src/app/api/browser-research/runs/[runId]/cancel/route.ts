import { NextRequest, NextResponse } from "next/server";
import {
  cancelBrowserResearchRun,
  getBrowserResearchRun,
} from "@/lib/ai/browser-research/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { assertCanAccessRoom } from "@/lib/server/room-access";

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
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);

    const serviceClient = createSupabaseSecretClient();
    const existing = await getBrowserResearchRun(serviceClient, workspaceId, params.runId);
    if (!existing) {
      return NextResponse.json({ error: "Browser research run not found." }, { status: 404 });
    }

    const isCreator = existing.createdBy === user.id;
    const isAdmin = role === "admin" || role === "owner";
    if (!isCreator && !isAdmin) {
      if (!existing.roomId) {
        throw new AuthError("You do not have permission to cancel this research run.", 403);
      }
      await assertCanAccessRoom(client, workspaceId, existing.roomId, user.id, role);
    }

    const run = await cancelBrowserResearchRun(
      serviceClient,
      existing.workspaceId,
      existing.id,
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
