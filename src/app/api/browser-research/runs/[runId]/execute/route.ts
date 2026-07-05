import { NextRequest, NextResponse } from "next/server";
import { runBrowserResearchRun } from "@/lib/ai/browser-research/server";
import { getBrowserResearchExecuteSecret } from "@/lib/ai/browser-research/async-execute";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ExecuteBody = {
  workspaceId?: string;
  agentRunId?: string;
};

function isAuthorizedExecuteRequest(request: NextRequest): boolean {
  const secret = getBrowserResearchExecuteSecret();
  if (!secret) {
    return process.env.NODE_ENV === "development";
  }
  return request.headers.get("x-adehq-research-execute-secret") === secret;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  if (!isAuthorizedExecuteRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as ExecuteBody;
    const workspaceId = body.workspaceId?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const client = createServiceRoleClient();
    const { run, chatReply } = await runBrowserResearchRun(client, workspaceId, params.runId, {
      agentRunId: body.agentRunId?.trim() || undefined,
    });

    return NextResponse.json({ ok: true, run, chatReply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research execution failed.";
    console.error("[AdeHQ browser research execute]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
