import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { assertEffectiveAiAccess } from "@/lib/server/room-access";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { loadRoomContext } from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";
import { createCallArtifact, getCall } from "@/lib/calls";
import { uid } from "@/lib/utils";

export const maxDuration = 60;

const schema = z.object({
  employeeId: z.string().min(1),
});

function sectionItems(text: string, heading: string) {
  const match = text.match(
    new RegExp(`(?:^|\\n)#{0,3}\\s*${heading}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n#{0,3}\\s*[A-Z][^\\n]*\\n|$)`, "i"),
  );
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter((line) => line && !/^none\b/i.test(line))
    .slice(0, 10);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Choose an invited employee.", 400);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    if (
      !call.participants.some(
        (participant) => participant.employeeId === parsed.data.employeeId,
      )
    ) {
      throw new AuthError("Invite this employee to the call first.", 422);
    }
    await assertEffectiveAiAccess(
      client,
      workspaceId,
      call.roomId,
      user.id,
      role,
      parsed.data.employeeId,
    );
    const { data: transcriptRows, error: transcriptError } = await service
      .from("call_artifacts")
      .select("content")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .contains("metadata", { source: "live_transcription" })
      .order("created_at");
    if (transcriptError) throw transcriptError;
    const transcript = (transcriptRows ?? [])
      .map((row) => String(row.content ?? ""))
      .filter(Boolean)
      .join("\n");
    if (!transcript) throw new AuthError("Start transcription before generating outcomes.", 409);

    const context = await loadRoomContext(client, workspaceId, call.roomId);
    const response = await processEmployeeResponse(
      client,
      context,
      parsed.data.employeeId,
      [
        `Summarize live call ${params.callId} from the transcript below.`,
        "Use exactly these headings: Summary, Decisions, Tasks, Unanswered questions, Risks.",
        "Use short bullet points. Do not invent owners, deadlines, or facts.",
        transcript.slice(-40_000),
      ].join("\n\n"),
      {
        mode: "live",
        initiatedByUserId: user.id,
        persistToRoom: false,
      },
    );
    let settledWh = 0;
    if (response.agentRunId) {
      const { data: ledgerRows } = await service
        .from("ai_cost_ledger_entries")
        .select("work_hours_charged")
        .eq("workspace_id", workspaceId)
        .contains("metadata", { agentRunId: response.agentRunId });
      settledWh = (ledgerRows ?? []).reduce(
        (total, row) => total + Number(row.work_hours_charged ?? 0),
        0,
      );
    }
    const summary = await createCallArtifact(service, {
      workspaceId,
      callId: params.callId,
      userId: user.id,
      type: "summary",
      title: "Call summary",
      content: response.reply,
      visibility: "shared",
    });
    const outcomes = [
      ...sectionItems(response.reply, "Decisions").map((title) => ({
        type: "decision" as const,
        title,
      })),
      ...sectionItems(response.reply, "Tasks").map((title) => ({
        type: "task" as const,
        title,
      })),
    ];
    const createdOutcomes = [];
    for (const outcome of outcomes) {
      createdOutcomes.push(
        await createCallArtifact(service, {
          workspaceId,
          callId: params.callId,
          userId: user.id,
          ...outcome,
          visibility: "shared",
        }),
      );
    }
    await service.from("call_ai_turns").insert({
      workspace_id: workspaceId,
      id: uid("call_ai_turn"),
      call_id: params.callId,
      employee_id: parsed.data.employeeId,
      mode: "silent_observer",
      state: "completed",
      transcript,
      response: response.reply,
      estimated_wh: settledWh,
      settled_wh: settledWh,
      completed_at: new Date().toISOString(),
      metadata: {
        summaryArtifactId: summary.id,
        outcomeCount: createdOutcomes.length,
        agentRunId: response.agentRunId ?? null,
      },
    });
    return NextResponse.json({
      summary,
      outcomes: createdOutcomes,
      settledWh,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ call summary]", error);
    return NextResponse.json({ error: "Could not generate call outcomes." }, { status: 500 });
  }
}
