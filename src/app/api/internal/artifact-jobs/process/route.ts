import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  isArtifactExportV1Enabled,
  isArtifactRuntimeV1Enabled,
} from "@/lib/artifacts/flags";
import { exportArtifact } from "@/lib/artifacts/client";
import { getArtifactRenderer } from "@/lib/artifacts/renderers/registry";
import type { ArtifactExportFormat } from "@/lib/artifacts/contracts/kinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertWorkerSecret(request: NextRequest): boolean {
  const expected =
    process.env.ADEHQ_WORKER_TOKEN_SECRET?.trim() ||
    process.env.ADEHQ_INTERNAL_WORKER_SECRET?.trim();
  if (!expected) return false;
  const header = request.headers.get("x-adehq-worker-secret")?.trim();
  return Boolean(header && header === expected);
}

export async function POST(request: NextRequest) {
  if (!assertWorkerSecret(request)) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid x-adehq-worker-secret." },
      { status: 401 },
    );
  }

  if (!isArtifactRuntimeV1Enabled() || !isArtifactExportV1Enabled()) {
    return NextResponse.json(
      { ok: false, error: "Artifact export runtime is disabled." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      exportId?: string;
    };
    const service = createSupabaseSecretClient();
    const limit = Math.min(20, Math.max(1, body.limit ?? 5));

    let q = service
      .from("artifact_exports")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (body.exportId) {
      q = service.from("artifact_exports").select("*").eq("id", body.exportId).limit(1);
    }

    const { data: jobs, error } = await q;
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs ?? []) {
      await service
        .from("artifact_exports")
        .update({ status: "running" })
        .eq("id", job.id);

      const { data: version } = await service
        .from("artifact_versions")
        .select("canonical_content, content_json")
        .eq("id", job.artifact_version_id)
        .maybeSingle();

      const renderer = getArtifactRenderer(job.renderer_key);
      if (!renderer) {
        await service
          .from("artifact_exports")
          .update({
            status: "failed",
            validation_results: { ok: false, errors: ["unknown renderer"] },
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        results.push({ id: job.id, ok: false, error: "unknown renderer" });
        continue;
      }

      const started = Date.now();
      const rendered = await exportArtifact({
        workspaceId: job.workspace_id,
        artifactId: job.artifact_id,
        versionId: job.artifact_version_id,
        canonical: version?.canonical_content ?? version?.content_json ?? {},
        rendererKey: job.renderer_key,
        format: job.format as ArtifactExportFormat,
      });

      await service
        .from("artifact_exports")
        .update({
          status: rendered.ok ? "completed" : "failed",
          storage_path: rendered.storagePath ?? job.storage_path,
          mime_type: rendered.mimeType ?? job.mime_type,
          file_size_bytes: rendered.buffer?.byteLength ?? null,
          validation_results: rendered.ok
            ? { ok: true }
            : { ok: false, errors: rendered.errors },
          duration_ms: Date.now() - started,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      results.push({ id: job.id, ok: rendered.ok, errors: rendered.errors });
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error("[AdeHQ artifact-jobs process]", error);
    return NextResponse.json({ ok: false, error: "Unable to process artifact jobs." }, { status: 500 });
  }
}
