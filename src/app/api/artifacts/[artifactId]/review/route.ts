import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { loadAccessibleArtifact } from "@/lib/artifacts/api-access";
import { isArtifactRuntimeV1Enabled } from "@/lib/artifacts/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewBody = {
  artifactVersionId?: string;
  status?: "pending" | "changes_requested" | "passed" | "approved" | "rejected";
  findings?: unknown[];
  scoreBreakdown?: Record<string, unknown>;
};

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
    const body = (await request.json()) as ReviewBody;
    if (!body.status) {
      return NextResponse.json({ ok: false, error: "status is required." }, { status: 400 });
    }

    let versionId = body.artifactVersionId;
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
      return NextResponse.json({ ok: false, error: "No artifact version to review." }, { status: 400 });
    }

    const resolved =
      body.status === "approved" || body.status === "rejected" || body.status === "passed"
        ? new Date().toISOString()
        : null;

    const { data: review, error } = await client
      .from("artifact_reviews")
      .insert({
        workspace_id: artifact.workspaceId,
        artifact_id: artifact.id,
        artifact_version_id: versionId,
        reviewer_type: "human",
        reviewer_user_id: user.id,
        status: body.status,
        findings: body.findings ?? [],
        score_breakdown: body.scoreBreakdown ?? {},
        resolved_at: resolved,
      })
      .select("*")
      .single();
    if (error) throw error;

    if (body.status === "changes_requested" || body.status === "approved" || body.status === "rejected") {
      await client
        .from("artifacts")
        .update({
          status:
            body.status === "approved"
              ? "approved"
              : body.status === "rejected"
                ? "draft"
                : "in_review",
        })
        .eq("id", artifact.id);

      await client
        .from("artifact_versions")
        .update({
          status:
            body.status === "approved"
              ? "approved"
              : body.status === "rejected"
                ? "draft"
                : "in_review",
        })
        .eq("id", versionId);
    }

    return NextResponse.json({ ok: true, review });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact review]", error);
    return NextResponse.json({ ok: false, error: "Unable to submit review." }, { status: 500 });
  }
}
