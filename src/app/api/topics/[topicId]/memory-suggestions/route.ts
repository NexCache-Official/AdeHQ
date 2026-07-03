import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";
import { insertWorkGraphEdge } from "@/lib/server/file-context";
import { buildMemoryEntryFields, memoryEntryToRow, memoryRowToEntry } from "@/lib/memory/build-entry";
import { resolveMemoryInsert } from "@/lib/memory/dedupe";
import { normalizeMemoryScope, scopeUsesTopicId } from "@/lib/memory/scope-rules";
import { nowISO, uid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveMemorySuggestionBody = {
  text: string;
  reason?: string;
  sourceFileId?: string;
  sourceChunkId?: string;
  sourceArtifactId?: string;
  sourceMessageId?: string;
  scope?: "topic" | "room" | "workspace" | "employee_dm" | "employee_profile" | "employee";
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

    const scope = normalizeMemoryScope(body.scope ?? "topic");
    const topicScoped = scopeUsesTopicId(scope);
    const fields = buildMemoryEntryFields({
      workspaceId,
      roomId,
      topicId: topicScoped ? params.topicId : null,
      userId: user.id,
      freeText: body.text.trim(),
      reason: body.reason,
      sourceFileId: body.sourceFileId,
      sourceArtifactId: body.sourceArtifactId,
      sourceMessageId: body.sourceMessageId,
      scopeOverride: scope,
      dedupeKey: "",
    });

    const dedupeInput = {
      workspaceId,
      title: fields.title,
      content: fields.content,
      scope,
      roomId,
      topicId: topicScoped ? params.topicId : null,
      sourceFileId: body.sourceFileId,
      sourceArtifactId: body.sourceArtifactId,
      sourceMessageId: body.sourceMessageId,
      suggestionKey: body.sourceFileId
        ? `file-memory:${body.sourceFileId}:${body.sourceChunkId ?? ""}:${fields.title}`
        : body.sourceArtifactId
          ? `artifact-memory:${body.sourceArtifactId}:${fields.title}`
          : undefined,
    };

    const { dedupeKey, existing } = await resolveMemoryInsert(client, workspaceId, dedupeInput);
    if (existing) {
      return NextResponse.json({
        memoryId: existing.id,
        duplicate: true,
        memory: existing,
      });
    }

    const memoryId = uid("mem");
    const createdAt = nowISO();
    const row = memoryEntryToRow(workspaceId, memoryId, fields, {
      roomId,
      topicId: topicScoped ? params.topicId : null,
      dedupeKey,
      createdAt,
    });

    const { data: inserted, error: insertError } = await client
      .from("memory_entries")
      .insert(row)
      .select("*")
      .single();
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
      summary: `Saved memory: ${fields.title}`,
      status: "success",
      related_entity_type: body.sourceMessageId ? "message" : "memory",
      related_entity_id: body.sourceMessageId ?? memoryId,
      created_at: nowISO(),
    });

    return NextResponse.json({
      memoryId,
      duplicate: false,
      memory: memoryRowToEntry(inserted as Record<string, unknown>),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ memory-suggestions POST]", error);
    return NextResponse.json({ error: "Unable to save memory suggestion." }, { status: 500 });
  }
}
