import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import {
  cancelledStepStatuses,
  isCancellableRunStatus,
} from "@/lib/playbooks/cancellation";
import { getPlaybookRun, updatePlaybookRunStatus } from "@/lib/playbooks/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Playbook runtime is disabled." },
        { status: 403 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const loaded = await getPlaybookRun(client, params.runId);
    if (!loaded) {
      return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
    }
    await requireWorkspaceMembership(client, loaded.run.workspace_id, user.id);

    if (!isCancellableRunStatus(loaded.run.status)) {
      return NextResponse.json(
        { ok: false, error: `Run status ${loaded.run.status} cannot be cancelled.` },
        { status: 400 },
      );
    }

    const statuses = cancelledStepStatuses();
    const now = new Date().toISOString();

    for (const step of loaded.steps) {
      let next = step.status;
      if (step.status === "pending") next = statuses.forPending;
      else if (step.status === "ready") next = statuses.forReady;
      else if (step.status === "running" || step.status === "leased") next = statuses.forRunning;
      else continue;

      await client
        .from("playbook_run_steps")
        .update({ status: next, completed_at: now })
        .eq("id", step.id);
    }

    const run = await updatePlaybookRunStatus(client, params.runId, "cancelled", {
      cancelled_at: now,
      completed_at: now,
      safe_error_message: "Cancelled by user",
      error_code: "cancelled",
    });

    return NextResponse.json({ ok: true, run });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook-run cancel]", error);
    return NextResponse.json({ ok: false, error: "Unable to cancel run." }, { status: 500 });
  }
}
