import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
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

    const workspaceId = await getWorkspaceIdForRoom(client, body.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

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
      },
      {
        headers: { "x-adehq-ai-mode": body.mode === "live" ? "live" : "mock" },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ respond route]", error);
    return NextResponse.json({ error: "Employee could not respond. Try again." }, { status: 500 });
  }
}
