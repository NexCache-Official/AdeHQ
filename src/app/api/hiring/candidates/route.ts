import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import {
  generateCandidateCopies,
  getCandidatesRuntimeDispatch,
} from "@/lib/hiring/candidates-llm";
import { resolveHiringWorkspaceContext } from "@/lib/server/hiring-workspace-context";
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

    if (!body.brief?.roleTitle) {
      return NextResponse.json({ error: "brief is required." }, { status: 400 });
    }

    let copies: Awaited<ReturnType<typeof generateCandidateCopies>>;

    if (!isSiliconFlowConfigured() && getCandidatesRuntimeDispatch() === "old") {
      copies = undefined;
    } else {
      const hiringContext = await resolveHiringWorkspaceContext(client, user.id, {
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
        roleKey: body.roleKey ?? null,
        departmentId: body.departmentId ?? null,
      });
    }

    const candidates = generateDeterministicCandidates(
      body.brief,
      body.departmentId ?? null,
      body.roleKey ?? null,
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
