import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  getWorkspaceIdForRoom,
  insertHumanMessage,
  loadRoomContext,
  parseEmployeeMentions,
} from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";

export const runtime = "nodejs";

type MessageBody = {
  content: string;
  clientMessageId?: string;
  mode?: "mock" | "live";
};

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as MessageBody;

    if (!body.content?.trim()) {
      return NextResponse.json({ error: "Message content is required." }, { status: 400 });
    }

    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    const ctx = await loadRoomContext(client, workspaceId, params.roomId);

    const profile = await client
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    const mentions = parseEmployeeMentions(body.content.trim(), ctx.employees).map((e) => e.id);

    const humanMessage = await insertHumanMessage(
      client,
      workspaceId,
      params.roomId,
      {
        id: user.id,
        name: profile.data?.name ?? user.email?.split("@")[0] ?? "You",
      },
      body.content.trim(),
      body.clientMessageId,
    );

    // Patch mentions on saved message
    if (mentions.length) {
      await client
        .from("messages")
        .update({ mentions })
        .eq("workspace_id", workspaceId)
        .eq("id", humanMessage.id);
      humanMessage.mentions = mentions;
    }

    const mentioned = parseEmployeeMentions(body.content, ctx.employees);

    const isDM = ctx.room.kind === "dm";
    const dmEmployee =
      isDM && ctx.room.dmEmployeeId
        ? ctx.employees.find((e) => e.id === ctx.room.dmEmployeeId)
        : undefined;

    const responders =
      mentioned.length > 0
        ? mentioned
        : isDM && dmEmployee
          ? [dmEmployee]
          : [];

    const aiResponses = [];
    const aiMessages = [];

    for (const employee of responders) {
      const response = await processEmployeeResponse(client, ctx, employee.id, body.content, {
        mode: body.mode,
        triggerMessageId: humanMessage.id,
      });
      aiResponses.push(response);
      aiMessages.push({
        id: response.aiMessageId,
        roomId: params.roomId,
        senderType: "ai" as const,
        senderId: employee.id,
        senderName: employee.name,
        content: response.reply,
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      humanMessage,
      aiResponses,
      aiMessages,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ messages route]", error);
    return NextResponse.json({ error: "Unable to send message." }, { status: 500 });
  }
}
