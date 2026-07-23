import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { selectNextClarificationQuestion } from "@/lib/hiring/workforce-studio/adaptive-questions";
import type {
  BusinessOperatingDiagnosis,
  ClarificationAnswer,
} from "@/lib/hiring/workforce-studio/diagnosis-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  workspaceId?: string;
  diagnosis?: BusinessOperatingDiagnosis;
  answers?: ClarificationAnswer[];
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );
    if (!body.diagnosis) {
      return NextResponse.json({ error: "diagnosis is required." }, { status: 400 });
    }
    const result = selectNextClarificationQuestion(body.diagnosis, body.answers ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return workforceStudioErrorResponse(error, "/architect/next-question");
  }
}
