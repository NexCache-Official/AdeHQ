import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { loadAccessibleArtifact } from "@/lib/artifacts/api-access";
import {
  isArtifactExportV1Enabled,
  isArtifactRuntimeV1Enabled,
} from "@/lib/artifacts/flags";
import { exportArtifact } from "@/lib/artifacts/client";
import { getArtifactRenderer } from "@/lib/artifacts/renderers/registry";
import type { ArtifactExportFormat } from "@/lib/artifacts/contracts/kinds";
import { buildIdempotencyKey } from "@/lib/playbooks/idempotency";
import { createSupabaseSecretClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMAT_RENDERER: Record<string, string> = {
  pptx: "pptx.pptxgenjs.v1",
  docx: "docx.docxjs.v1",
  xlsx: "xlsx.exceljs.v1",
  pdf: "pdf.playwright.v1",
  html: "html.preview.v1",
};

type ExportBody = {
  format?: ArtifactExportFormat;
  rendererKey?: string;
  artifactVersionId?: string;
  idempotencyKey?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    if (!isArtifactRuntimeV1Enabled() || !isArtifactExportV1Enabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Artifact export is disabled (ADEHQ_ARTIFACT_RUNTIME_V1 / ADEHQ_ARTIFACT_EXPORT_V1).",
        },
        { status: 403 },
      );
    }

    const { user, client, artifact } = await loadAccessibleArtifact(request, params.artifactId);
    const body = (await request.json()) as ExportBody;
    const format = body.format ?? "docx";
    const rendererKey = body.rendererKey ?? FORMAT_RENDERER[format];
    if (!rendererKey || !getArtifactRenderer(rendererKey)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported export format/renderer: ${format}` },
        { status: 400 },
      );
    }

    let versionId = body.artifactVersionId;
    let canonical: unknown = null;
    if (versionId) {
      const { data: ver } = await client
        .from("artifact_versions")
        .select("*")
        .eq("id", versionId)
        .eq("artifact_id", artifact.id)
        .maybeSingle();
      if (!ver) {
        return NextResponse.json({ ok: false, error: "Version not found." }, { status: 404 });
      }
      canonical = ver.canonical_content ?? ver.content_json;
    } else {
      const { data: ver } = await client
        .from("artifact_versions")
        .select("*")
        .eq("artifact_id", artifact.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!ver) {
        return NextResponse.json({ ok: false, error: "No version to export." }, { status: 400 });
      }
      versionId = ver.id;
      canonical = ver.canonical_content ?? ver.content_json;
    }

    const idempotencyKey =
      body.idempotencyKey?.trim() ||
      buildIdempotencyKey([artifact.workspaceId, artifact.id, versionId!, format, rendererKey]);

    const { data: existing } = await client
      .from("artifact_exports")
      .select("*")
      .eq("workspace_id", artifact.workspaceId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, export: existing, reused: true });
    }

    const rendered = await exportArtifact({
      workspaceId: artifact.workspaceId,
      artifactId: artifact.id,
      versionId: versionId!,
      canonical: canonical ?? { title: artifact.title, sections: [] },
      rendererKey,
      format,
      generatedBy: user.id,
    });

    const renderer = getArtifactRenderer(rendererKey)!;
    const row = {
      workspace_id: artifact.workspaceId,
      artifact_id: artifact.id,
      artifact_version_id: versionId!,
      format,
      mime_type: rendered.mimeType ?? renderer.mimeType,
      storage_path: rendered.storagePath ?? null,
      renderer_key: renderer.key,
      renderer_version: renderer.version,
      status: rendered.ok ? "completed" : "failed",
      file_size_bytes: rendered.buffer?.byteLength ?? null,
      idempotency_key: idempotencyKey,
      validation_results: rendered.ok ? { ok: true } : { ok: false, errors: rendered.errors },
      completed_at: rendered.ok ? new Date().toISOString() : null,
    };

    // Prefer user client; fall back to service if RLS write is restricted.
    let insert = await client.from("artifact_exports").insert(row).select("*").single();
    if (insert.error) {
      const service = createSupabaseSecretClient();
      insert = await service.from("artifact_exports").insert(row).select("*").single();
    }
    if (insert.error) throw insert.error;

    return NextResponse.json({
      ok: rendered.ok,
      export: insert.data,
      errors: rendered.errors,
      reused: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact export]", error);
    return NextResponse.json({ ok: false, error: "Unable to export artifact." }, { status: 500 });
  }
}
