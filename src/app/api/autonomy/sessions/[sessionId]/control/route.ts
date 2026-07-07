import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { getSession, listSteps, pauseSession, requestStop, resumeSession } from "@/lib/autonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ControlBody = { action?: "stop" | "pause" | "resume" };

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as ControlBody;
    if (!body.action || !["stop", "pause", "resume"].includes(body.action)) {
      return NextResponse.json({ error: "action must be stop, pause, or resume." }, { status: 400 });
    }

    const existing = await getSession(client, params.sessionId);
    if (!existing) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    await requireWorkspaceMembership(client, existing.workspaceId, user.id);

    const session =
      body.action === "stop"
        ? await requestStop(client, params.sessionId)
        : body.action === "pause"
          ? await pauseSession(client, params.sessionId)
          : await resumeSession(client, params.sessionId);

    const steps = await listSteps(client, params.sessionId);
    return NextResponse.json({ session, steps });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ autonomy control]", error);
    return NextResponse.json({ error: "Unable to control session." }, { status: 500 });
  }
}
