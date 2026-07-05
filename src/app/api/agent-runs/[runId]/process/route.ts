import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { processQueuedAgentRun, AgentRunClaimError } from "@/lib/server/process-queued-run";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { debugErrorPayload, serializeUnknownError } from "@/lib/server/message-errors";
import { roomIdFromRow } from "@/lib/server/db-row";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      mode?: "mock" | "live";
    };

    const { data: runRow, error: runError } = await client
      .from("agent_runs")
      .select("workspace_id, room_id, topic_id, status, response_reason")
      .eq("id", params.runId)
      .maybeSingle();

    if (runError) throw runError;
    if (!runRow) {
      return NextResponse.json({ error: "Agent run not found." }, { status: 404 });
    }

    const workspaceId = body.workspaceId ?? String(runRow.workspace_id);
    const roomId = roomIdFromRow(runRow as Record<string, unknown>);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(
      client,
      workspaceId,
      roomId,
      user.id,
      role,
    );

    const debug = request.headers.get("X-AdeHQ-Debug") === "true";
    let serviceClient;
    try {
      serviceClient = createServiceRoleClient();
    } catch (err) {
      const hint =
        "SUPABASE_SERVICE_ROLE_KEY is not set on the server. Add it in Vercel env vars.";
      return NextResponse.json(
        {
          ok: false,
          error: hint,
          debug: debug ? { step: "createServiceRoleClient", detail: String(err) } : undefined,
        },
        { status: 500 },
      );
    }

    const result = await processQueuedAgentRun(
      serviceClient,
      workspaceId,
      params.runId,
      {
        mode: body.mode,
      },
    );

    return NextResponse.json({
      ok: true,
      runId: params.runId,
      ...result,
      followUpRuns: result.followUpRuns ?? [],
      activatedRuns: result.activatedRuns ?? [],
      collaborationPlan: result.collaborationPlan,
      pendingResearch: result.pendingResearch ?? false,
      researchRun: result.researchRun,
      responseReason: runRow.response_reason
        ? String(runRow.response_reason)
        : undefined,
      aiMessage: result.aiMessageId
        ? {
            id: result.aiMessageId,
            roomId,
            topicId: runRow.topic_id ? String(runRow.topic_id) : undefined,
            senderType: "ai" as const,
            senderId: result.employeeId,
            senderName: result.employeeName,
            content: result.reply,
            artifacts: result.artifacts,
            agentRunId: params.runId,
          }
        : undefined,
      metrics: result.metrics,
    });
  } catch (error) {
    if (error instanceof AgentRunClaimError) {
      return NextResponse.json(
        { ok: false, error: error.code, code: error.code },
        { status: 409 },
      );
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ process agent run]", error);
    const message = serializeUnknownError(error);
    try {
      const serviceClient = createServiceRoleClient();
      await serviceClient
        .from("agent_runs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: nowISO(),
        })
        .eq("id", params.runId)
        .in("status", ["queued", "waiting", "running"]);
    } catch {
      // best-effort — prevents infinite client recovery loops
    }
    const debug = request.headers.get("X-AdeHQ-Debug") === "true";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        debug: debug
          ? {
              ...debugErrorPayload(error),
              hint: message.includes("SILICONFLOW") || message.includes("API key")
                ? "Set SILICONFLOW_API_KEY in Vercel environment variables."
                : message.includes("SERVICE_ROLE") || message.includes("service role")
                  ? "Set SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables."
                  : message.includes("null value") && message.includes("id")
                    ? "Database insert missing required id — redeploy latest code."
                    : undefined,
            }
          : undefined,
      },
      { status: 500 },
    );
  }
}
