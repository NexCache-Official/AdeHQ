import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanSendRoomMessage } from "@/lib/server/room-access";
import {
  debugErrorPayload,
  messageError,
  serializeUnknownError,
} from "@/lib/server/message-errors";
import {
  getWorkspaceIdForRoom,
  insertHumanMessage,
} from "@/lib/server/room-messages";
import { assertTopicInRoom, ensureGeneralTopic } from "@/lib/server/topic-helpers";
import type { MentionRef } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveBody = {
  content: string;
  topicId?: string;
  clientMessageId?: string;
  mentionsJson?: MentionRef[];
};

function displayNameFromUser(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  const meta = user.user_metadata;
  const fromMeta =
    (typeof meta?.full_name === "string" && meta.full_name) ||
    (typeof meta?.name === "string" && meta.name);
  if (fromMeta) return fromMeta;
  return user.email?.split("@")[0] ?? "You";
}

/** Lightweight human-message save — no orchestration imports (Browse mode). */
export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  const debug = request.headers.get("X-AdeHQ-Debug") === "true";

  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as SaveBody;

    if (!body.content?.trim()) {
      return messageError("message_required", "Message content is required.", 400);
    }

    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return messageError("room_not_found", "Room not found.", 404);
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    try {
      await assertCanSendRoomMessage(client, workspaceId, params.roomId, user.id, role);
    } catch (err) {
      if (err instanceof AuthError) {
        return messageError("not_room_member", err.message, err.status);
      }
      const msg = err instanceof Error ? err.message : "Unable to send message.";
      if (msg.includes("archived")) {
        return messageError("room_archived", msg, 400);
      }
      throw err;
    }

    let topicId = body.topicId;
    if (!topicId) {
      const general = await ensureGeneralTopic(client, workspaceId, params.roomId);
      topicId = general.id;
    }

    try {
      await assertTopicInRoom(client, workspaceId, params.roomId, topicId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Topic not found.";
      if (msg.includes("archived")) {
        return messageError("topic_archived", msg, 400, { topicId });
      }
      if (msg.includes("room is archived")) {
        return messageError("room_archived", msg, 400, { topicId });
      }
      return messageError("topic_not_in_room", msg, 404, { topicId });
    }

    const humanMessage = await insertHumanMessage(
      client,
      workspaceId,
      params.roomId,
      { id: user.id, name: displayNameFromUser(user) },
      body.content.trim(),
      topicId,
      body.clientMessageId,
      body.mentionsJson?.length ? body.mentionsJson : undefined,
    );

    return NextResponse.json({ humanMessage, skippedOrchestration: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return messageError("not_room_member", error.message, error.status);
    }
    console.error("[AdeHQ messages/save]", error);
    const detail = serializeUnknownError(error);
    return messageError(
      "send_failed",
      `Unable to save message: ${detail}`,
      500,
      debug ? { debug: debugErrorPayload(error) } : undefined,
    );
  }
}
