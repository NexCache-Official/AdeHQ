import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { artifactFromRow } from "@/lib/files/records";
import { memoryEntryToRow, memoryRowToEntry } from "@/lib/memory/build-entry";
import { resolveMemoryInsert } from "@/lib/memory/dedupe";
import { artifactMemoryDraftFromArtifact } from "@/lib/artifacts/intelligence";
import { categoryToLegacyType, normalizeCategory } from "@/lib/memory/categories";
import { nowISO, uid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { data: artifactRow, error } = await client
      .from("artifacts")
      .select("*")
      .eq("id", params.artifactId)
      .maybeSingle();
    if (error) throw error;
    if (!artifactRow) {
      return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
    }

    const artifact = artifactFromRow(artifactRow as Record<string, unknown>);
    if (!artifact.roomId) {
      return NextResponse.json({ error: "Artifact is not linked to a room." }, { status: 400 });
    }

    if (artifact.memorySavedAt) {
      const { data: existing } = await client
        .from("memory_entries")
        .select("*")
        .eq("workspace_id", artifact.workspaceId)
        .contains("metadata", { sourceArtifactId: artifact.id })
        .maybeSingle();
      if (existing) {
        const memory = memoryRowToEntry(existing as Record<string, unknown>);
        return NextResponse.json({ memory, memorySavedAt: artifact.memorySavedAt, duplicate: true });
      }
    }

    const { role } = await requireWorkspaceMembership(client, artifact.workspaceId, user.id);
    await assertCanAccessRoom(client, artifact.workspaceId, artifact.roomId, user.id, role);

    const draft = artifactMemoryDraftFromArtifact({
      title: artifact.title,
      artifactType: artifact.artifactType,
      contentMarkdown: artifact.contentMarkdown,
      contentJson: artifact.contentJson,
    });

    const dedupeInput = {
      workspaceId: artifact.workspaceId,
      title: draft.title,
      content: draft.content,
      scope: "topic" as const,
      roomId: artifact.roomId,
      topicId: artifact.topicId ?? null,
      suggestionKey: `artifact-memory:${artifact.id}`,
    };

    const { dedupeKey, existing } = await resolveMemoryInsert(
      client,
      artifact.workspaceId,
      dedupeInput,
    );
    if (existing) {
      const savedAt = nowISO();
      await client
        .from("artifacts")
        .update({ memory_saved_at: savedAt })
        .eq("workspace_id", artifact.workspaceId)
        .eq("id", artifact.id);
      return NextResponse.json({ memory: existing, memorySavedAt: savedAt, duplicate: true });
    }

    const memoryId = uid("mem");
    const createdAt = nowISO();
    const category = normalizeCategory(draft.category);
    const row = memoryEntryToRow(
      artifact.workspaceId,
      memoryId,
      {
        title: draft.title,
        content: draft.content,
        type: categoryToLegacyType(category),
        category,
        scope: "topic",
        tags: draft.tags,
        sourceType: "artifact",
        savedByUserId: user.id,
        metadata: {
          sourceArtifactId: artifact.id,
          sourceRoomId: artifact.roomId,
          sourceTopicId: artifact.topicId,
          sourceMessageIds: artifact.sourceMessageIds,
        },
      },
      {
        roomId: artifact.roomId,
        topicId: artifact.topicId ?? null,
        dedupeKey,
        createdAt,
      },
    );

    const { data: memoryRow, error: memoryError } = await client
      .from("memory_entries")
      .insert(row)
      .select("*")
      .single();
    if (memoryError) throw memoryError;

    const memory = memoryRowToEntry(memoryRow as Record<string, unknown>);
    const savedAt = nowISO();
    await client
      .from("artifacts")
      .update({
        memory_saved_at: savedAt,
        status: artifact.status === "draft" ? "saved" : artifact.status,
      })
      .eq("workspace_id", artifact.workspaceId)
      .eq("id", artifact.id);

    await client.from("work_log_events").insert({
      workspace_id: artifact.workspaceId,
      id: uid("log"),
      room_id: artifact.roomId,
      topic_id: artifact.topicId ?? null,
      employee_id: user.id,
      action: "saved_artifact_to_memory",
      summary: `Saved ${artifact.title} to memory`,
      status: "success",
      related_entity_type: "artifact",
      related_entity_id: artifact.id,
      created_at: savedAt,
    });

    return NextResponse.json({
      memory,
      memorySavedAt: savedAt,
      duplicate: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact save-memory]", error);
    return NextResponse.json({ error: "Unable to save artifact to memory." }, { status: 500 });
  }
}
