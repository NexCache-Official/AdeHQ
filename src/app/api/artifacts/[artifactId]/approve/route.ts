import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { loadAccessibleArtifact } from "@/lib/artifacts/api-access";
import { isArtifactRuntimeV1Enabled } from "@/lib/artifacts/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    if (!isArtifactRuntimeV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Artifact runtime is disabled (ADEHQ_ARTIFACT_RUNTIME_V1)." },
        { status: 403 },
      );
    }

    const { user, client, artifact } = await loadAccessibleArtifact(request, params.artifactId);
    const body = (await request.json().catch(() => ({}))) as { artifactVersionId?: string };

    let versionId = body.artifactVersionId ?? (artifact as { currentVersionId?: string }).currentVersionId;
    if (!versionId) {
      const { data: latest } = await client
        .from("artifact_versions")
        .select("id")
        .eq("artifact_id", artifact.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      versionId = latest?.id;
    }
    if (!versionId) {
      return NextResponse.json({ ok: false, error: "No artifact version to approve." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data: review, error } = await client
      .from("artifact_reviews")
      .insert({
        workspace_id: artifact.workspaceId,
        artifact_id: artifact.id,
        artifact_version_id: versionId,
        reviewer_type: "human",
        reviewer_user_id: user.id,
        status: "approved",
        findings: [],
        score_breakdown: {},
        resolved_at: now,
      })
      .select("*")
      .single();
    if (error) throw error;

    await client.from("artifacts").update({ status: "approved" }).eq("id", artifact.id);
    await client
      .from("artifact_versions")
      .update({ status: "approved" })
      .eq("id", versionId);

    return NextResponse.json({ ok: true, review, status: "approved" });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact approve]", error);
    return NextResponse.json({ ok: false, error: "Unable to approve artifact." }, { status: 500 });
  }
}
