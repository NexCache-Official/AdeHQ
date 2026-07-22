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
import { getCall } from "@/lib/calls";
import { uid } from "@/lib/utils";
import { upsertWorkGraphEdge } from "@/lib/inbox/work-graph";

export const maxDuration = 120;

const schema = z.object({
  employeeIds: z.array(z.string().min(1)).min(2).max(5),
  question: z.string().min(3).max(12_000),
});

async function settledForRun(
  service: ReturnType<typeof createSupabaseSecretClient>,
  workspaceId: string,
  agentRunId?: string,
) {
  if (!agentRunId) return 0;
  const { data } = await service
    .from("ai_cost_ledger_entries")
    .select("work_hours_charged")
    .eq("workspace_id", workspaceId)
    .contains("metadata", { agentRunId });
  return (data ?? []).reduce(
    (total, row) => total + Number(row.work_hours_charged ?? 0),
    0,
  );
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
    if (!parsed.success) throw new AuthError("Choose two to five invited employees.", 400);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const ids = [...new Set(parsed.data.employeeIds)];
    const participants = ids.map((employeeId) =>
      call.participants.find((participant) => participant.employeeId === employeeId),
    );
    if (participants.some((participant) => !participant)) {
      throw new AuthError("Every council member must be invited to the call.", 422);
    }
    const humans = call.participants.filter((participant) => participant.userId);
    const { data: consentRows, error: consentError } = await service
      .from("call_consents")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("consent_type", "ai_listening")
      .eq("granted", true);
    if (consentError) throw consentError;
    const consented = new Set((consentRows ?? []).map((row) => String(row.user_id)));
    if (!humans.every((participant) => consented.has(participant.userId!))) {
      throw new AuthError("Every human participant must consent before the council works.", 409);
    }
    await Promise.all(
      ids.map((employeeId) =>
        assertEffectiveAiAccess(
          client,
          workspaceId,
          call.roomId,
          user.id,
          role,
          employeeId,
        ),
      ),
    );
    const context = await loadRoomContext(client, workspaceId, call.roomId);
    const findings = await Promise.all(
      ids.map(async (employeeId) => {
        const response = await processEmployeeResponse(
          client,
          context,
          employeeId,
          `Expert council question: ${parsed.data.question}\nReturn your specialist finding concisely. Do not address the call aloud.`,
          {
            mode: "live",
            initiatedByUserId: user.id,
            persistToRoom: false,
          },
        );
        return {
          employeeId,
          response,
          settledWh: await settledForRun(service, workspaceId, response.agentRunId),
        };
      }),
    );
    const spokespersonParticipant =
      participants.find((participant) => participant?.participationMode === "facilitator") ??
      participants.find((participant) => participant?.participationMode === "on_request") ??
      participants[0]!;
    const spokespersonEmployeeId = spokespersonParticipant!.employeeId!;
    const synthesis = await processEmployeeResponse(
      client,
      context,
      spokespersonEmployeeId,
      [
        "You are the single spokesperson selected by the call Steward policy.",
        `Question: ${parsed.data.question}`,
        "Synthesize the expert findings below into one concise recommendation. Note disagreements.",
        ...findings.map(
          (finding) => `[${finding.employeeId}] ${finding.response.reply}`,
        ),
      ].join("\n\n"),
      {
        mode: "live",
        initiatedByUserId: user.id,
        persistToRoom: false,
      },
    );
    const synthesisWh = await settledForRun(service, workspaceId, synthesis.agentRunId);
    const ownerId = call.createdBy ?? user.id;
    await Promise.all(
      findings.map(async (finding) => {
        const turnId = uid("call_ai_turn");
        await service.from("call_ai_turns").insert({
          workspace_id: workspaceId,
          id: turnId,
          call_id: params.callId,
          employee_id: finding.employeeId,
          mode:
            call.participants.find((participant) => participant.employeeId === finding.employeeId)
              ?.participationMode ?? "advisor",
          state: "completed",
          transcript: parsed.data.question,
          response: finding.response.reply,
          estimated_wh: finding.settledWh,
          settled_wh: finding.settledWh,
          completed_at: new Date().toISOString(),
          metadata: { council: true, spokesperson: false },
        });
        await service.from("call_artifacts").insert({
          workspace_id: workspaceId,
          id: uid("call_art"),
          call_id: params.callId,
          room_id: call.roomId,
          artifact_type: "note",
          visibility: "private",
          title: "Council specialist finding",
          content: finding.response.reply,
          owner_id: ownerId,
          source_employee_id: finding.employeeId,
          metadata: { turnId, council: true },
        });
      }),
    );
    const artifactId = uid("call_art");
    await service.from("call_artifacts").insert({
      workspace_id: workspaceId,
      id: artifactId,
      call_id: params.callId,
      room_id: call.roomId,
      artifact_type: "artifact",
      visibility: "shared",
      title: "Expert council recommendation",
      content: synthesis.reply,
      owner_id: user.id,
      source_employee_id: spokespersonEmployeeId,
      metadata: {
        council: true,
        spokespersonEmployeeId,
        policy: "facilitator_then_on_request",
      },
    });
    await upsertWorkGraphEdge(service, {
      workspaceId,
      fromObjectType: "call",
      fromObjectId: params.callId,
      relationType: "produced_council_finding",
      toObjectType: "call_artifact",
      toObjectId: artifactId,
      metadata: { spokespersonEmployeeId },
    });
    const settledWh =
      findings.reduce((total, finding) => total + finding.settledWh, 0) + synthesisWh;
    return NextResponse.json({
      reply: synthesis.reply,
      spokespersonEmployeeId,
      artifactId,
      settledWh,
      specialistCount: findings.length,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ call council]", error);
    return NextResponse.json({ error: "The expert council could not finish." }, { status: 500 });
  }
}
