import { NextRequest, NextResponse } from "next/server";
import { getBrowserResearchRun } from "@/lib/ai/browser-research/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import type { RoomMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const run = await getBrowserResearchRun(client, workspaceId, params.runId);
    if (!run) {
      return NextResponse.json({ error: "Research run not found." }, { status: 404 });
    }

    let chatReply: RoomMessage | null = null;
    const chatReplyMessageId =
      typeof run.metadata.chatReplyMessageId === "string"
        ? run.metadata.chatReplyMessageId
        : undefined;

    if (chatReplyMessageId) {
      const { data: row } = await client
        .from("messages")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", chatReplyMessageId)
        .maybeSingle();
      if (row) {
        chatReply = {
          id: String(row.id),
          roomId: String(row.room_id),
          topicId: row.topic_id ? String(row.topic_id) : undefined,
          senderType: row.sender_type as RoomMessage["senderType"],
          senderId: String(row.sender_id),
          senderName: String(row.sender_name ?? "AI"),
          content: String(row.content ?? ""),
          agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
          createdAt: String(row.created_at),
        };
      }
    }

    return NextResponse.json({ run, chatReply });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load research run.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
