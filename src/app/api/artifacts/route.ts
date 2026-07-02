import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { artifactFromRow } from "@/lib/files/records";
import { nowISO, uid } from "@/lib/utils";
import type { SavedArtifactType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARTIFACT_TYPES: SavedArtifactType[] = [
  "prd",
  "report",
  "brief",
  "research_summary",
  "meeting_notes",
  "strategy_memo",
  "email_draft",
  "proposal",
  "checklist",
  "decision",
  "note",
  "other",
];

type CreateArtifactBody = {
  workspaceId?: string;
  roomId?: string | null;
  topicId?: string | null;
  title?: string;
  artifactType?: SavedArtifactType;
  contentMarkdown?: string;
  contentJson?: Record<string, unknown>;
  sourceFileIds?: string[];
  sourceMessageIds?: string[];
  sourceChunkIds?: string[];
  sourceCitations?: Array<Record<string, unknown>>;
  messageId?: string;
  status?: "draft" | "saved";
};

async function validateSourceFiles(
  client: Awaited<ReturnType<typeof requireAuthUser>>["client"],
  workspaceId: string,
  sourceFileIds: string[],
) {
  if (!sourceFileIds.length) return;
  const { data, error } = await client
    .from("workspace_files")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", sourceFileIds);
  if (error) throw error;
  if ((data ?? []).length !== sourceFileIds.length) {
    throw new AuthError("One or more source files are not accessible.", 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as CreateArtifactBody;

    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!body.title?.trim()) {
      return NextResponse.json({ error: "Artifact title is required." }, { status: 400 });
    }
    if (!body.contentMarkdown?.trim()) {
      return NextResponse.json({ error: "Artifact content is required." }, { status: 400 });
    }
    const artifactType = body.artifactType ?? "note";
    if (!ARTIFACT_TYPES.includes(artifactType)) {
      return NextResponse.json({ error: "Unsupported artifact type." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    if (body.roomId) {
      await assertCanAccessRoom(client, body.workspaceId, body.roomId, user.id, role);
    }

    const sourceFileIds = [...new Set(body.sourceFileIds ?? [])];
    const sourceMessageIds = [...new Set(body.sourceMessageIds ?? [])];
    const sourceChunkIds = [...new Set(body.sourceChunkIds ?? [])];
    await validateSourceFiles(client, body.workspaceId, sourceFileIds);

    const { data: artifactRow, error } = await client
      .from("artifacts")
      .insert({
        workspace_id: body.workspaceId,
        room_id: body.roomId ?? null,
        topic_id: body.topicId ?? null,
        title: body.title.trim(),
        artifact_type: artifactType,
        status: body.status ?? "draft",
        content_markdown: body.contentMarkdown,
        content_json: body.contentJson ?? {},
        created_by_type: "human",
        created_by_id: user.id,
        source_file_ids: sourceFileIds,
        source_message_ids: sourceMessageIds,
        source_chunk_ids: sourceChunkIds,
        source_citations: body.sourceCitations ?? [],
      })
      .select("*")
      .single();
    if (error) throw error;

    const artifact = artifactFromRow(artifactRow as Record<string, unknown>);

    const { error: versionError } = await client.from("artifact_versions").insert({
      artifact_id: artifact.id,
      version_number: 1,
      content_markdown: artifact.contentMarkdown,
      content_json: artifact.contentJson,
      source_citations: artifact.sourceCitations,
      created_by_type: "human",
      created_by_id: user.id,
    });
    if (versionError) throw versionError;

    if (body.messageId) {
      await client.from("message_attachments").insert({
        workspace_id: body.workspaceId,
        message_id: body.messageId,
        artifact_id: artifact.id,
        attachment_type: "artifact",
      });
    }

    if (body.roomId) {
      await client.from("work_log_events").insert({
        workspace_id: body.workspaceId,
        id: uid("log"),
        room_id: body.roomId,
        topic_id: body.topicId ?? null,
        employee_id: user.id,
        action: "created_artifact",
        summary: `Created ${artifact.artifactType.replace(/_/g, " ")}: ${artifact.title}`,
        status: "success",
        related_entity_type: "artifact",
        related_entity_id: artifact.id,
        created_at: nowISO(),
      });
    }

    return NextResponse.json({ artifact });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifacts POST]", error);
    return NextResponse.json({ error: "Unable to create artifact." }, { status: 500 });
  }
}
