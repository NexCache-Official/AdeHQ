import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { fetchTopicSummary } from "@/lib/topic-summary/persistence";
import {
  saveSuggestedMemoryToMemory,
  saveTopicSummaryToMemory,
} from "@/lib/topic-summary/save-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      suggestionIndex?: number;
    };

    const { data: topicRow, error: topicError } = await client
      .from("channel_topics")
      .select("*")
      .eq("id", params.topicId)
      .maybeSingle();
    if (topicError) throw topicError;
    if (!topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const topic = topicFromRow(topicRow);
    const { role } = await requireWorkspaceMembership(client, topic.workspaceId, user.id);
    await assertCanAccessRoom(client, topic.workspaceId, topic.roomId, user.id, role);

    if (typeof body.suggestionIndex === "number") {
      const summary = await fetchTopicSummary(client, topic.workspaceId, params.topicId);
      const suggestion = summary?.suggestedMemory[body.suggestionIndex];
      if (!suggestion) {
        return NextResponse.json({ error: "Memory suggestion not found." }, { status: 404 });
      }
      const { memoryId } = await saveSuggestedMemoryToMemory(client, {
        workspaceId: topic.workspaceId,
        roomId: topic.roomId,
        topicId: params.topicId,
        userId: user.id,
        suggestion,
      });
      return NextResponse.json({ ok: true, memoryId });
    }

    const { memoryId } = await saveTopicSummaryToMemory(client, {
      workspaceId: topic.workspaceId,
      roomId: topic.roomId,
      topicId: params.topicId,
      topicTitle: topic.title,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, memoryId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unable to save to memory.";
    console.error("[AdeHQ topic summary save-memory]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
