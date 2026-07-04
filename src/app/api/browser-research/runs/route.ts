import { NextRequest, NextResponse } from "next/server";
import {
  browserResearchCompletedMessage,
  BrowserResearchPermissionError,
  getBrowserResearchProviderConfig,
} from "@/lib/ai/browser-research";
import {
  createAndRunBrowserResearch,
  listBrowserResearchRuns,
} from "@/lib/ai/browser-research/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  workspaceId?: string;
  roomId?: string | null;
  topicId?: string | null;
  employeeId?: string;
  query?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody;
    const workspaceId = body.workspaceId?.trim();
    const employeeId = body.employeeId?.trim();
    const query = body.query?.trim() ?? "";

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }
    if (!query) {
      return NextResponse.json({ error: "query is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const serviceClient = createServiceRoleClient();
    const run = await createAndRunBrowserResearch(serviceClient, {
      workspaceId,
      roomId: body.roomId?.trim() || undefined,
      topicId: body.topicId?.trim() || undefined,
      employeeId,
      createdBy: user.id,
      query,
    });

    return NextResponse.json({
      run,
      message: browserResearchCompletedMessage(run.provider),
      config: getBrowserResearchProviderConfig(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof BrowserResearchPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Failed to create research run.";
    if (message.includes("SERVICE_ROLE")) {
      return NextResponse.json({ error: "Server configuration incomplete." }, { status: 503 });
    }
    console.error("[AdeHQ browser research POST]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    const topicId = request.nextUrl.searchParams.get("topicId")?.trim();
    const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const runs = await listBrowserResearchRuns(client, {
      workspaceId,
      topicId: topicId || undefined,
      employeeId: employeeId || undefined,
      limit: 20,
    });

    return NextResponse.json({
      runs,
      config: getBrowserResearchProviderConfig(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to list research runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
