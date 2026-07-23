import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import { processPlaybookRunWave } from "@/lib/playbooks/runtime/process-run";

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

  if (!isPlaybookRuntimeV1Enabled()) {
    return NextResponse.json(
      { ok: false, error: "Playbook runtime is disabled (ADEHQ_PLAYBOOK_RUNTIME_V1)." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      runId?: string;
    };
    const service = createSupabaseSecretClient();
    const limit = Math.min(20, Math.max(1, body.limit ?? 5));

    let runs: Array<{ id: string }> = [];
    if (body.runId) {
      runs = [{ id: body.runId }];
    } else {
      const { data, error } = await service
        .from("playbook_runs")
        .select("id")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      runs = (data ?? []) as Array<{ id: string }>;
    }

    const results: Array<Record<string, unknown>> = [];
    for (const run of runs) {
      const wave = await processPlaybookRunWave(service, {
        runId: run.id,
        serviceClient: service,
      });
      results.push({
        runId: wave.runId,
        ok: wave.ok,
        status: wave.status,
        processedStepKeys: wave.processedStepKeys,
        artifactsCreated: wave.artifactsCreated,
        error: wave.error,
      });
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error("[AdeHQ playbook-jobs process]", error);
    return NextResponse.json(
      { ok: false, error: "Unable to process playbook jobs." },
      { status: 500 },
    );
  }
}
