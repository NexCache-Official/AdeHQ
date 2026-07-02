import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { artifactFromRow } from "@/lib/files/records";
import type { SavedArtifactStatus, SavedArtifactType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchArtifactBody = {
  title?: string;
  artifactType?: SavedArtifactType;
  status?: SavedArtifactStatus;
  contentMarkdown?: string;
  contentJson?: Record<string, unknown>;
  sourceCitations?: Array<Record<string, unknown>>;
};

async function loadAccessibleArtifact(request: NextRequest, artifactId: string) {
  const { user, client } = await requireAuthUser(request);
  const { data, error } = await client
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("Artifact not found.", 404);

  const artifact = artifactFromRow(data as Record<string, unknown>);
  const { role } = await requireWorkspaceMembership(client, artifact.workspaceId, user.id);
  if (artifact.roomId) {
    await assertCanAccessRoom(client, artifact.workspaceId, artifact.roomId, user.id, role);
  }
  return { user, client, artifact };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    const { client, artifact } = await loadAccessibleArtifact(request, params.artifactId);
    const { data: versions, error } = await client
      .from("artifact_versions")
      .select("*")
      .eq("artifact_id", artifact.id)
      .order("version_number", { ascending: false });
    if (error) throw error;

    return NextResponse.json({ artifact, versions: versions ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact GET]", error);
    return NextResponse.json({ error: "Unable to load artifact." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    const { user, client, artifact } = await loadAccessibleArtifact(request, params.artifactId);
    const body = (await request.json()) as PatchArtifactBody;
    const patch: Record<string, unknown> = {};

    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.artifactType !== undefined) patch.artifact_type = body.artifactType;
    if (body.status !== undefined) patch.status = body.status;
    if (body.contentMarkdown !== undefined) patch.content_markdown = body.contentMarkdown;
    if (body.contentJson !== undefined) patch.content_json = body.contentJson;
    if (body.sourceCitations !== undefined) patch.source_citations = body.sourceCitations;

    if (!Object.keys(patch).length) {
      return NextResponse.json({ artifact });
    }

    const { data: updatedRow, error } = await client
      .from("artifacts")
      .update(patch)
      .eq("workspace_id", artifact.workspaceId)
      .eq("id", artifact.id)
      .select("*")
      .single();
    if (error) throw error;

    const updated = artifactFromRow(updatedRow as Record<string, unknown>);
    const { data: latestVersion } = await client
      .from("artifact_versions")
      .select("version_number")
      .eq("artifact_id", artifact.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error: versionError } = await client.from("artifact_versions").insert({
      artifact_id: artifact.id,
      version_number: Number(latestVersion?.version_number ?? 0) + 1,
      content_markdown: updated.contentMarkdown,
      content_json: updated.contentJson,
      source_citations: updated.sourceCitations,
      created_by_type: "human",
      created_by_id: user.id,
    });
    if (versionError) throw versionError;

    return NextResponse.json({ artifact: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact PATCH]", error);
    return NextResponse.json({ error: "Unable to update artifact." }, { status: 500 });
  }
}
