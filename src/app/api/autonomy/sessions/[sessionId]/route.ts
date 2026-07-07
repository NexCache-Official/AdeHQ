import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  createRuntimeBrain,
  driveSession,
  getSession,
  listSteps,
  resumeIfApprovalResolved,
} from "@/lib/autonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);

    let session = await getSession(client, params.sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    await requireWorkspaceMembership(client, session.workspaceId, user.id);

    // Poll-driven nudge: resume after an approval, or drive queued work forward.
    if (session.status === "waiting_approval") {
      const resumed = await resumeIfApprovalResolved(client, session.id);
      if (resumed) session = resumed;
    }
    if (session.status === "queued" || session.status === "running") {
      const brain = createRuntimeBrain({ workspaceId: session.workspaceId, employeeId: session.employeeId });
      const driven = await driveSession(client, session.id, brain);
      if (driven) session = driven;
    }

    const steps = await listSteps(client, session.id);
    return NextResponse.json({ session, steps });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ autonomy get]", error);
    return NextResponse.json({ error: "Unable to load session." }, { status: 500 });
  }
}
