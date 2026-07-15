import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership, getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { assertCanSendRoomMessage } from "@/lib/server/room-access";
import {
  AmbiguousRoomWorkspaceError,
  getWorkspaceIdForRoom,
  loadRoomContext,
} from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";

export const runtime = "nodejs";

type RespondBody = {
  roomId: string;
  triggerMessageId?: string;
  content: string;
  mode?: "mock" | "live";
  workspaceId?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { employeeId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as RespondBody;

    if (!body.roomId || !body.content?.trim()) {
      return NextResponse.json({ error: "roomId and content are required." }, { status: 400 });
    }

    const preferredWorkspaceId =
      getRequestWorkspaceId(request) || body.workspaceId?.trim() || null;
    const workspaceId = await getWorkspaceIdForRoom(client, body.roomId, preferredWorkspaceId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanSendRoomMessage(client, workspaceId, body.roomId, user.id, role);

    const ctx = await loadRoomContext(client, workspaceId, body.roomId);
    const employee = ctx.employees.find((e) => e.id === params.employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found in workspace." }, { status: 404 });
    }

    const response = await processEmployeeResponse(client, ctx, params.employeeId, body.content, {
      mode: body.mode,
      triggerMessageId: body.triggerMessageId,
    });

    return NextResponse.json(
      {
        employeeId: response.employeeId,
        employeeName: response.employeeName,
        reply: response.reply,
        effect: response.effect,
        aiMode: response.aiMode,
      },
      {
        headers: { "x-adehq-ai-mode": response.aiMode },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AmbiguousRoomWorkspaceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ respond route]", error);
    return NextResponse.json({ error: "Employee could not respond. Try again." }, { status: 500 });
  }
}
