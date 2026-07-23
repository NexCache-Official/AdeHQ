import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import { getPlaybookRun } from "@/lib/playbooks/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Playbook runtime is disabled (ADEHQ_PLAYBOOK_RUNTIME_V1)." },
        { status: 404 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const loaded = await getPlaybookRun(client, params.runId);
    if (!loaded) {
      return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
    }
    await requireWorkspaceMembership(client, loaded.run.workspace_id, user.id);

    const completed = loaded.steps.filter((s) => s.status === "completed").length;
    const total = loaded.steps.length;
    const progressPct = total ? Math.round((completed / total) * 100) : 0;

    return NextResponse.json({
      ok: true,
      run: loaded.run,
      steps: loaded.steps,
      progress: {
        completed,
        total,
        progressPct,
        actualWh: loaded.run.actual_wh,
        estimatedWhMin: loaded.run.estimated_wh_min,
        estimatedWhMax: loaded.run.estimated_wh_max,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook-run GET]", error);
    return NextResponse.json({ ok: false, error: "Unable to load playbook run." }, { status: 500 });
  }
}
