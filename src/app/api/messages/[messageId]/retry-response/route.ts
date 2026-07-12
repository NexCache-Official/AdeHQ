import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { loadRespondersContext } from "@/lib/server/room-messages";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { serializeUnknownError } from "@/lib/server/message-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Regenerates one employee's whole response to a message — used when the
 * original turn failed outright (model error/timeout) or produced no real
 * effect (fabricated tool-call claim), so there's nothing narrower to retry.
 * Reuses the same queue+claim machinery a normal incoming message goes
 * through: a fresh agent_runs row is queued and the caller processes it via
 * the existing POST /api/agent-runs/[runId]/process endpoint.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { messageId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as { employeeId?: string };
    if (!body.employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const { data: messageRow, error: messageError } = await client
      .from("messages")
      .select("id, workspace_id, room_id, topic_id, content")
      .eq("id", params.messageId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!messageRow) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }

    const workspaceId = String(messageRow.workspace_id);
    const roomId = String(messageRow.room_id);
    const topicId = messageRow.topic_id ? String(messageRow.topic_id) : "";
    if (!topicId) {
      return NextResponse.json({ error: "Message has no topic to retry into." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, roomId, user.id, role);

    const serviceClient = createSupabaseSecretClient();
    const { employees } = await loadRespondersContext(serviceClient, workspaceId, roomId);
    const employee = employees.find((e) => e.id === body.employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found in this room." }, { status: 404 });
    }

    const { queued, blocked } = await queueAgentRuns(serviceClient, {
      workspaceId,
      roomId,
      topicId,
      triggerMessageId: params.messageId,
      responders: [{ employee, reason: "manual_retry" }],
      content: String(messageRow.content ?? ""),
    });

    if (!queued.length) {
      return NextResponse.json(
        { error: blocked[0]?.reason ?? "Could not queue a retry run." },
        { status: 500 },
      );
    }

    return NextResponse.json({ queued });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ retry-response]", error);
    return NextResponse.json({ error: serializeUnknownError(error) }, { status: 500 });
  }
}
