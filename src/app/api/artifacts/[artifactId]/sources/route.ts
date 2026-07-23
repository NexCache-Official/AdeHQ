import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { loadAccessibleArtifact } from "@/lib/artifacts/api-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sources / provenance for an artifact (list allowed when runtime OFF). */
export async function GET(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    const { client, artifact } = await loadAccessibleArtifact(request, params.artifactId);

    const { data: versions } = await client
      .from("artifact_versions")
      .select("id")
      .eq("artifact_id", artifact.id);

    const versionIds = (versions ?? []).map((v) => v.id as string);
    let provenance: unknown[] = [];
    if (versionIds.length) {
      const { data, error } = await client
        .from("artifact_provenance")
        .select("*")
        .in("artifact_version_id", versionIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      provenance = data ?? [];
    }

    return NextResponse.json({
      ok: true,
      sources: {
        fileIds: artifact.sourceFileIds ?? [],
        messageIds: artifact.sourceMessageIds ?? [],
        chunkIds: artifact.sourceChunkIds ?? [],
        citations: artifact.sourceCitations ?? [],
      },
      provenance,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact sources GET]", error);
    return NextResponse.json({ ok: false, error: "Unable to load sources." }, { status: 500 });
  }
}
