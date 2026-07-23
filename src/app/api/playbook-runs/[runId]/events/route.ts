import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import { getPlaybookRun } from "@/lib/playbooks/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns step status transitions as a simple event list. */
export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Playbook runtime is disabled." },
        { status: 404 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const loaded = await getPlaybookRun(client, params.runId);
    if (!loaded) {
      return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
    }
    await requireWorkspaceMembership(client, loaded.run.workspace_id, user.id);

    const events = [
      {
        type: "run_status",
        at: loaded.run.created_at,
        status: loaded.run.status,
        runId: loaded.run.id,
      },
      ...loaded.steps.map((step) => ({
        type: "step_status",
        at: step.updated_at ?? step.created_at,
        stepKey: step.step_key,
        status: step.status,
        actualWh: step.actual_wh,
        errorCode: step.error_code,
        message: step.safe_error_message,
      })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

    return NextResponse.json({ ok: true, events });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook-run events]", error);
    return NextResponse.json({ ok: false, error: "Unable to load events." }, { status: 500 });
  }
}
