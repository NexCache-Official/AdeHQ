import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { isProcedureRuntimeV1Enabled } from "@/lib/procedures/flags";
import { executeProcedure } from "@/lib/procedures/executor";
import { getProcedureManifest } from "@/lib/procedures/registry";

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

  if (!isProcedureRuntimeV1Enabled()) {
    return NextResponse.json(
      { ok: false, error: "Procedure runtime is disabled (ADEHQ_PROCEDURE_RUNTIME_V1)." },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      executionId?: string;
    };
    const service = createSupabaseSecretClient();
    const limit = Math.min(20, Math.max(1, body.limit ?? 5));

    let q = service
      .from("procedure_executions")
      .select("*, procedure_versions(executor_key, manifest)")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (body.executionId) {
      q = service
        .from("procedure_executions")
        .select("*, procedure_versions(executor_key, manifest)")
        .eq("id", body.executionId)
        .limit(1);
    }

    const { data: jobs, error } = await q;
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs ?? []) {
      const versionRow = job.procedure_versions as {
        executor_key?: string;
        manifest?: { executorKey?: string };
      } | null;
      const key =
        versionRow?.executor_key ??
        versionRow?.manifest?.executorKey ??
        getProcedureManifest(String(versionRow?.executor_key ?? ""))?.executorKey;
      if (!key) {
        await service
          .from("procedure_executions")
          .update({
            status: "failed",
            error_code: "procedure_executor_missing",
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        results.push({ id: job.id, ok: false, error: "executor missing" });
        continue;
      }

      await service
        .from("procedure_executions")
        .update({ status: "running" })
        .eq("id", job.id);

      const started = Date.now();
      const input =
        typeof job.input_hash === "string"
          ? ((job as { input_payload?: Record<string, unknown> }).input_payload ?? {})
          : {};

      const result = await executeProcedure(key, input, {
        backpack: {
          workspaceId: job.workspace_id,
          brainRunId: job.brain_run_id,
          playbookRunStepId: job.playbook_run_step_id,
          idempotencyKey: job.idempotency_key,
        },
      });

      await service
        .from("procedure_executions")
        .update({
          status: result.ok ? "completed" : "failed",
          output_payload: result.output ?? {},
          error_code: result.errorCode ?? null,
          duration_ms: Date.now() - started,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      results.push({
        id: job.id,
        ok: result.ok,
        errorCode: result.errorCode,
        executorKey: key,
      });
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error("[AdeHQ procedure-jobs process]", error);
    return NextResponse.json({ ok: false, error: "Unable to process procedure jobs." }, { status: 500 });
  }
}
