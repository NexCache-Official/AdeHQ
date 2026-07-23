import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import { classifyRetry } from "@/lib/playbooks/retry";
import {
  getPlaybookRun,
  updatePlaybookRunStatus,
  upsertPlaybookRunStep,
} from "@/lib/playbooks/repository";

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
    const body = (await request.json().catch(() => ({}))) as { stepKey?: string };
    const loaded = await getPlaybookRun(client, params.runId);
    if (!loaded) {
      return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });
    }
    await requireWorkspaceMembership(client, loaded.run.workspace_id, user.id);

    if (loaded.run.status !== "failed" && loaded.run.status !== "blocked") {
      return NextResponse.json(
        { ok: false, error: `Run status ${loaded.run.status} is not retryable.` },
        { status: 400 },
      );
    }

    const failedSteps = loaded.steps.filter(
      (s) =>
        s.status === "failed" &&
        (!body.stepKey || s.step_key === body.stepKey),
    );
    if (!failedSteps.length) {
      return NextResponse.json(
        { ok: false, error: "No failed steps to retry." },
        { status: 400 },
      );
    }

    for (const step of failedSteps) {
      const decision = classifyRetry(step.error_code);
      if (decision === "never") {
        return NextResponse.json(
          {
            ok: false,
            error: `Step ${step.step_key} error ${step.error_code ?? "unknown"} is not retryable.`,
          },
          { status: 400 },
        );
      }
      await upsertPlaybookRunStep(client, {
        playbookRunId: params.runId,
        stepKey: step.step_key,
        status: "ready",
        dependsOn: step.depends_on,
        assignedEmployeeId: step.assigned_employee_id,
        estimatedWh: step.estimated_wh,
        attemptCount: (step.attempt_count ?? 0) + 1,
        errorCode: null,
        safeErrorMessage: null,
        completedAt: null,
      });
    }

    const run = await updatePlaybookRunStatus(client, params.runId, "queued", {
      error_code: null,
      safe_error_message: null,
    });

    const refreshed = await getPlaybookRun(client, params.runId);
    return NextResponse.json({ ok: true, run, steps: refreshed?.steps ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook-run retry]", error);
    return NextResponse.json({ ok: false, error: "Unable to retry run." }, { status: 500 });
  }
}
