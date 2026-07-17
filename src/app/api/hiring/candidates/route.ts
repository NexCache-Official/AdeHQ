import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { resolveHiringWorkspaceContextForAdmin } from "@/lib/server/hiring-workspace-context";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import {
  generateCandidateCopies,
  getCandidatesRuntimeDispatch,
} from "@/lib/hiring/candidates-llm";
import {
  generateDeterministicCandidates,
} from "@/lib/hiring/candidate-engine";
import type { AiEmployeeJobBrief } from "@/lib/hiring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CandidatesBody = {
  brief: AiEmployeeJobBrief;
  departmentId?: string | null;
  roleKey?: string | null;
  workspaceId?: string | null;
  hiringSessionId?: string | null;
  topicId?: string | null;
  mayaRoomId?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as CandidatesBody;

    await resolveHiringWorkspaceContextForAdmin(client, user.id, {
      workspaceId: body.workspaceId,
      hiringSessionId: body.hiringSessionId,
      topicId: body.topicId,
      mayaRoomId: body.mayaRoomId,
    });

    if (!body.brief?.roleTitle) {
      return NextResponse.json({ error: "brief is required." }, { status: 400 });
    }

    const roleKey = body.roleKey ?? null;
    // Library roles already have strong deterministic shortlists — skip the
    // candidate-copy LLM + workspace work-unit path so hire→review stays fast.
    const useDeterministicOnly =
      Boolean(roleKey && roleKey !== "custom") ||
      (!isSiliconFlowConfigured() && getCandidatesRuntimeDispatch() === "old");

    let copies: Awaited<ReturnType<typeof generateCandidateCopies>>;

    if (useDeterministicOnly) {
      copies = undefined;
    } else {
      const hiringContext = await resolveHiringWorkspaceContextForAdmin(client, user.id, {
        workspaceId: body.workspaceId,
        hiringSessionId: body.hiringSessionId,
        topicId: body.topicId,
        mayaRoomId: body.mayaRoomId,
      });

      copies = await generateCandidateCopies(body.brief, {
        client,
        userId: user.id,
        workspaceId: hiringContext.workspaceId,
        hiringSessionId: hiringContext.hiringSessionId,
        roleKey,
        departmentId: body.departmentId ?? null,
      });
    }

    const candidates = generateDeterministicCandidates(
      body.brief,
      body.departmentId ?? null,
      roleKey,
      copies,
    );

    return NextResponse.json({ candidates, usedFallback: !copies });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[hiring/candidates]", err);
    return NextResponse.json({ error: "Candidate generation failed." }, { status: 500 });
  }
}
