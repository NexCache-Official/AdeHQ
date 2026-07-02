import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { artifactFromRow } from "@/lib/files/records";
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

    const { role } = await requireWorkspaceMembership(client, artifact.workspaceId, user.id);
    await assertCanAccessRoom(client, artifact.workspaceId, artifact.roomId, user.id, role);

    const memoryId = uid("mem");
    const content = [
      `Artifact: ${artifact.title}`,
      "",
      artifact.contentMarkdown.slice(0, 4000),
    ].join("\n");

    const { data: memoryRow, error: memoryError } = await client
      .from("memory_entries")
      .insert({
        workspace_id: artifact.workspaceId,
        id: memoryId,
        room_id: artifact.roomId,
        topic_id: artifact.topicId ?? null,
        type: "general",
        title: artifact.title,
        content,
        status: "draft",
        created_by_type: "human",
        created_by_id: user.id,
        created_at: nowISO(),
      })
      .select("*")
      .single();
    if (memoryError) throw memoryError;

    const savedAt = nowISO();
    await client
      .from("artifacts")
      .update({ memory_saved_at: savedAt, status: artifact.status === "draft" ? "saved" : artifact.status })
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

    return NextResponse.json({ memory: memoryRow, memorySavedAt: savedAt });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact save-memory]", error);
    return NextResponse.json({ error: "Unable to save artifact to memory." }, { status: 500 });
  }
}
