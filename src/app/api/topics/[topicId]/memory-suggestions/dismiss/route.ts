import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";
import { updateMemorySuggestionLifecycle } from "@/lib/topic-summary/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as { suggestionKey?: string };
    if (!body.suggestionKey?.trim()) {
      return NextResponse.json({ error: "suggestionKey is required." }, { status: 400 });
    }

    const { data: topicRow, error: topicError } = await client
      .from("topics")
      .select("workspace_id, room_id")
      .eq("id", params.topicId)
      .single();
    if (topicError || !topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const workspaceId = String(topicRow.workspace_id);
    const roomId = String(topicRow.room_id);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertTopicInRoom(client, workspaceId, roomId, params.topicId);

    const lifecycle = await updateMemorySuggestionLifecycle(client, {
      workspaceId,
      topicId: params.topicId,
      suggestionKey: body.suggestionKey.trim(),
      state: "dismissed",
    });

    return NextResponse.json({ ok: true, lifecycle });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ memory-suggestions dismiss]", error);
    return NextResponse.json({ error: "Unable to dismiss memory suggestion." }, { status: 500 });
  }
}
