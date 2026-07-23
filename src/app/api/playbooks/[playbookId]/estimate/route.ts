import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { isSeedPlaybookId, resolveSeedDefinition } from "@/lib/playbooks/api-helpers";
import { estimatePlaybookWh } from "@/lib/playbooks/estimator";
import { getPlaybook } from "@/lib/playbooks/repository";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import type { PlaybookDefinitionV1 } from "@/lib/playbooks/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estimate WH for a playbook definition.
 * Allowed against seed catalog even when runtime is OFF (read-only planning).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { playbookId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      definition?: PlaybookDefinitionV1;
    };
    if (!body.workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    let definition = body.definition ?? null;

    if (!definition) {
      if (isSeedPlaybookId(params.playbookId) || !isPlaybookRuntimeV1Enabled()) {
        definition = resolveSeedDefinition(params.playbookId) ?? null;
      } else {
        const loaded = await getPlaybook(client, params.playbookId);
        definition =
          (loaded?.version?.definition as PlaybookDefinitionV1 | undefined) ??
          resolveSeedDefinition(params.playbookId) ??
          null;
      }
    }

    if (!definition) {
      return NextResponse.json({ ok: false, error: "Playbook not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      estimate: estimatePlaybookWh(definition),
      runtimeEnabled: isPlaybookRuntimeV1Enabled(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook estimate]", error);
    return NextResponse.json({ ok: false, error: "Unable to estimate playbook." }, { status: 500 });
  }
}
