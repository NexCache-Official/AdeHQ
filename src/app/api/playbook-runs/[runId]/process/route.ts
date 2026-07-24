import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import { getPlaybookRun } from "@/lib/playbooks/repository";
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

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Playbook runtime is disabled (ADEHQ_PLAYBOOK_RUNTIME_V1).",
        },
        { status: 403 },
      );
    }

    const workerAuth = assertWorkerSecret(request);
    let client;
    let serviceClient: ReturnType<typeof createSupabaseSecretClient> | undefined;

    if (workerAuth) {
      serviceClient = createSupabaseSecretClient();
      client = serviceClient;
    } else {
      const auth = await requireAuthUser(request);
      client = auth.client;
      const loaded = await getPlaybookRun(client, params.runId);
      if (!loaded) {
        return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
      }
      await requireWorkspaceMembership(client, loaded.run.workspace_id, auth.user.id);
      try {
        serviceClient = createSupabaseSecretClient();
      } catch {
        serviceClient = undefined;
      }
    }

    const result = await processPlaybookRunWave(client, {
      runId: params.runId,
      serviceClient,
    });

    return NextResponse.json({
      ok: result.ok,
      runId: result.runId,
      processedStepKeys: result.processedStepKeys,
      status: result.status,
      artifactsCreated: result.artifactsCreated,
      error: result.error,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook-run process]", error);
    return NextResponse.json(
      { ok: false, error: "Unable to process playbook run." },
      { status: 500 },
    );
  }
}
