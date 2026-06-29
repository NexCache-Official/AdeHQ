import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  assertCanSendRoomMessage,
} from "@/lib/server/room-access";
import {
  getWorkspaceIdForRoom,
  insertHumanMessage,
  loadRoomContext,
  parseEmployeeMentions,
} from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";
import { loadMaxParallelRuns } from "@/lib/ai/cost-guard";
import type { MentionRef } from "@/lib/types";

export const runtime = "nodejs";

type MessageBody = {
  content: string;
  clientMessageId?: string;
  mode?: "mock" | "live";
  mentionsJson?: MentionRef[];
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

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanSendRoomMessage(client, workspaceId, params.roomId, user.id, role);

    const ctx = await loadRoomContext(client, workspaceId, params.roomId);

    const profile = await client
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    const trimmed = body.content.trim();
    const mentionsJson = body.mentionsJson?.length ? body.mentionsJson : undefined;
    const mentioned = parseEmployeeMentions(trimmed, ctx.employees, mentionsJson);
    const mentions = mentioned.map((e) => e.id);

    const humanMessage = await insertHumanMessage(
      client,
      workspaceId,
      params.roomId,
      {
        id: user.id,
        name: profile.data?.name ?? user.email?.split("@")[0] ?? "You",
      },
      trimmed,
      body.clientMessageId,
      mentionsJson,
    );

    if (mentions.length && !mentionsJson) {
      await client
        .from("messages")
        .update({ mentions })
        .eq("workspace_id", workspaceId)
        .eq("id", humanMessage.id);
    }
    humanMessage.mentions = mentions;
    if (mentionsJson) humanMessage.mentionsJson = mentionsJson;

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

    if (responders.length === 0) {
      return NextResponse.json({
        humanMessage,
        aiResponses: [],
        aiMessages: [],
        hint: "Mention an employee with @ to get a response",
      });
    }

    const maxParallel = await loadMaxParallelRuns(client, workspaceId);
    const capped = responders.slice(0, Math.min(maxParallel, 3));

    const settled = await Promise.allSettled(
      capped.map((employee) =>
        processEmployeeResponse(client, ctx, employee.id, trimmed, {
          mode: body.mode,
          triggerMessageId: humanMessage.id,
        }),
      ),
    );

    const aiResponses = [];
    const aiMessages = [];

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const employee = capped[i];
      if (result.status === "rejected") {
        console.error("[AdeHQ messages route] employee response failed", result.reason);
        continue;
      }
      const response = result.value;
      aiResponses.push(response);
      aiMessages.push({
        id: response.aiMessageId,
        roomId: params.roomId,
        senderType: "ai" as const,
        senderId: employee.id,
        senderName: employee.name,
        content: response.reply,
        createdAt: new Date().toISOString(),
        agentRunId: response.agentRunId,
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
