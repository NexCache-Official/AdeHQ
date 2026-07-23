import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
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

    if (loaded.run.status !== "awaiting_approval") {
      return NextResponse.json(
        { ok: false, error: `Run is ${loaded.run.status}, not awaiting approval.` },
        { status: 400 },
      );
    }

    const run = await updatePlaybookRunStatus(client, params.runId, "queued", {
      started_at: null,
    });

    return NextResponse.json({ ok: true, run });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook-run approve]", error);
    return NextResponse.json({ ok: false, error: "Unable to approve run." }, { status: 500 });
  }
}
