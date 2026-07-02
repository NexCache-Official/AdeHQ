import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";
import { insertWorkGraphEdge } from "@/lib/server/file-context";
import { nowISO, uid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveMemorySuggestionBody = {
  text: string;
  reason?: string;
  sourceFileId?: string;
  sourceChunkId?: string;
  sourceArtifactId?: string;
  scope?: "topic" | "room" | "workspace";
};

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as SaveMemorySuggestionBody;

    if (!body.text?.trim()) {
      return NextResponse.json({ error: "Memory text is required." }, { status: 400 });
    }

    const { data: topicRow, error: topicError } = await client
      .from("topics")
      .select("workspace_id, room_id, title")
      .eq("id", params.topicId)
      .single();
    if (topicError || !topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const workspaceId = String(topicRow.workspace_id);
    const roomId = String(topicRow.room_id);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertTopicInRoom(client, workspaceId, roomId, params.topicId);

    if (body.sourceFileId) {
      const { data: fileRow } = await client
        .from("workspace_files")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("id", body.sourceFileId)
        .maybeSingle();
      if (!fileRow) {
        return NextResponse.json({ error: "Source file not found." }, { status: 400 });
      }
    }

    const topicScoped = (body.scope ?? "topic") === "topic";
    const memoryId = uid("mem");
    const contentParts = [body.text.trim()];
    if (body.reason?.trim()) contentParts.push(`\n\nReason: ${body.reason.trim()}`);
    if (body.sourceFileId) contentParts.push(`\n\nSource file id: ${body.sourceFileId}`);
    if (body.sourceChunkId) contentParts.push(`\nSource chunk id: ${body.sourceChunkId}`);
    if (body.sourceArtifactId) contentParts.push(`\nSource artifact id: ${body.sourceArtifactId}`);

    const { error: insertError } = await client.from("memory_entries").insert({
      workspace_id: workspaceId,
      id: memoryId,
      room_id: roomId,
      topic_id: topicScoped ? params.topicId : null,
      type: "general",
      title: body.text.trim().slice(0, 120),
      content: contentParts.join(""),
      status: "approved",
      created_by_type: "human",
      created_by_id: user.id,
      created_at: nowISO(),
    });
    if (insertError) throw insertError;

    if (body.sourceFileId) {
      await insertWorkGraphEdge(client, {
        workspaceId,
        fromObjectType: "memory",
        fromObjectId: memoryId,
        relationType: "sources_file",
        toObjectType: "file",
        toObjectId: body.sourceFileId,
      }).catch(() => undefined);
    }
    if (body.sourceArtifactId) {
      await insertWorkGraphEdge(client, {
        workspaceId,
        fromObjectType: "memory",
        fromObjectId: memoryId,
        relationType: "sources_artifact",
        toObjectType: "artifact",
        toObjectId: body.sourceArtifactId,
      }).catch(() => undefined);
    }

    await client.from("work_log_events").insert({
      workspace_id: workspaceId,
      id: uid("log"),
      room_id: roomId,
      topic_id: params.topicId,
      employee_id: user.id,
      action: "saved_file_memory",
      summary: `Saved memory from file work: ${body.text.trim().slice(0, 80)}`,
      status: "success",
      related_entity_type: "memory",
      related_entity_id: memoryId,
      created_at: nowISO(),
    });

    return NextResponse.json({ memoryId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ memory-suggestions POST]", error);
    return NextResponse.json({ error: "Unable to save memory suggestion." }, { status: 500 });
  }
}
