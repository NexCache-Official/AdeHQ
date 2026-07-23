import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { loadAccessibleArtifact } from "@/lib/artifacts/api-access";
import {
  isArtifactRuntimeV1Enabled,
} from "@/lib/artifacts/flags";
import { createVersion } from "@/lib/artifacts/client";
import { stableChecksum } from "@/lib/playbooks/checksum";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    const { client, artifact } = await loadAccessibleArtifact(request, params.artifactId);
    const { data, error } = await client
      .from("artifact_versions")
      .select("*")
      .eq("artifact_id", artifact.id)
      .order("version_number", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ ok: true, versions: data ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact versions GET]", error);
    return NextResponse.json({ ok: false, error: "Unable to list versions." }, { status: 500 });
  }
}

type CreateVersionBody = {
  contentMarkdown?: string;
  contentJson?: Record<string, unknown>;
  canonicalContent?: unknown;
  schemaKey?: string;
  schemaVersion?: number;
  status?: "draft" | "in_review" | "approved" | "published";
  origin?: string;
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
    const body = (await request.json()) as CreateVersionBody;

    const { data: latest } = await client
      .from("artifact_versions")
      .select("version_number")
      .eq("artifact_id", artifact.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const versionNumber = Number(latest?.version_number ?? 0) + 1;
    const versionId = randomUUID();
    const canonical = body.canonicalContent ?? body.contentJson ?? null;

    let contentHash: string | null = null;
    let qualityOk = true;
    let qualityErrors: string[] = [];

    if (canonical != null) {
      const prepared = await createVersion({
        workspaceId: artifact.workspaceId,
        artifactId: artifact.id,
        versionId,
        canonical,
      });
      contentHash = prepared.contentHash || stableChecksum(canonical);
      qualityOk = prepared.qualityOk;
      qualityErrors = prepared.errors;
    }

    const { data: version, error } = await client
      .from("artifact_versions")
      .insert({
        id: versionId,
        artifact_id: artifact.id,
        version_number: versionNumber,
        content_markdown: body.contentMarkdown ?? artifact.contentMarkdown ?? "",
        content_json: body.contentJson ?? artifact.contentJson ?? {},
        canonical_content: canonical,
        content_hash: contentHash,
        schema_key: body.schemaKey ?? null,
        schema_version: body.schemaVersion ?? null,
        status: body.status ?? "draft",
        origin: body.origin ?? "manual",
        created_by_type: "human",
        created_by_id: user.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    await client
      .from("artifacts")
      .update({
        current_version_id: version.id,
        ...(body.contentMarkdown != null ? { content_markdown: body.contentMarkdown } : {}),
        ...(body.contentJson != null ? { content_json: body.contentJson } : {}),
      })
      .eq("id", artifact.id);

    return NextResponse.json({
      ok: true,
      version,
      qualityOk,
      qualityErrors,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact versions POST]", error);
    return NextResponse.json({ ok: false, error: "Unable to create version." }, { status: 500 });
  }
}
