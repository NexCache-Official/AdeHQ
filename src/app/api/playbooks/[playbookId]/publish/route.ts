import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  isCustomPlaybooksV1Enabled,
  isPlaybookRuntimeV1Enabled,
} from "@/lib/playbooks/flags";
import { isSeedPlaybookId } from "@/lib/playbooks/api-helpers";
import { getPlaybook } from "@/lib/playbooks/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { playbookId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled() || !isCustomPlaybooksV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Playbook publish requires runtime + custom playbooks flags." },
        { status: 403 },
      );
    }
    if (isSeedPlaybookId(params.playbookId)) {
      return NextResponse.json(
        { ok: false, error: "Platform seeds are already published." },
        { status: 400 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as { workspaceId?: string };
    if (!body.workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const loaded = await getPlaybook(client, params.playbookId);
    if (!loaded || loaded.playbook.workspace_id !== body.workspaceId) {
      return NextResponse.json({ ok: false, error: "Playbook not found." }, { status: 404 });
    }
    if (!loaded.version) {
      return NextResponse.json(
        { ok: false, error: "Playbook has no version to publish." },
        { status: 400 },
      );
    }

    const { data, error } = await client
      .from("playbooks")
      .update({ status: "published" })
      .eq("id", params.playbookId)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, playbook: data });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook publish]", error);
    return NextResponse.json({ ok: false, error: "Unable to publish playbook." }, { status: 500 });
  }
}
