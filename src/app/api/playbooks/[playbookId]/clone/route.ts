import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  isCustomPlaybooksV1Enabled,
  isPlaybookRuntimeV1Enabled,
} from "@/lib/playbooks/flags";
import { isSeedPlaybookId, resolveSeedDefinition } from "@/lib/playbooks/api-helpers";
import { estimatePlaybookWh } from "@/lib/playbooks/estimator";
import { getPlaybook } from "@/lib/playbooks/repository";
import { stableChecksum } from "@/lib/playbooks/checksum";
import type { PlaybookDefinitionV1 } from "@/lib/playbooks/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { playbookId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled() || !isCustomPlaybooksV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Playbook clone requires runtime + custom playbooks flags." },
        { status: 403 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as {
      workspaceId?: string;
      key?: string;
      name?: string;
    };
    if (!body.workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    let definition: PlaybookDefinitionV1 | null = null;
    let sourceName = "Playbook";

    if (isSeedPlaybookId(params.playbookId)) {
      definition = resolveSeedDefinition(params.playbookId) ?? null;
      sourceName = definition?.name ?? sourceName;
    } else {
      const loaded = await getPlaybook(client, params.playbookId);
      if (!loaded?.version?.definition) {
        definition = resolveSeedDefinition(params.playbookId) ?? null;
        sourceName = definition?.name ?? sourceName;
      } else {
        definition = loaded.version.definition as PlaybookDefinitionV1;
        sourceName = loaded.playbook.name;
      }
    }

    if (!definition) {
      return NextResponse.json({ ok: false, error: "Playbook not found." }, { status: 404 });
    }

    const key =
      body.key?.trim() ||
      `${definition.key}_copy_${Date.now().toString(36)}`;
    const name = body.name?.trim() || `${sourceName} (copy)`;
    const cloned: PlaybookDefinitionV1 = {
      ...definition,
      key,
      name,
      visibility: "workspace",
      status: "draft",
    };

    const { data: playbook, error } = await client
      .from("playbooks")
      .insert({
        workspace_id: body.workspaceId,
        key,
        name,
        description: cloned.description ?? null,
        category: cloned.category,
        industry_tags: cloned.industryTags ?? [],
        visibility: "workspace",
        status: "draft",
        created_by_user_id: user.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    const est = estimatePlaybookWh(cloned);
    const { data: version, error: verErr } = await client
      .from("playbook_versions")
      .insert({
        playbook_id: playbook.id,
        version: 1,
        definition: cloned,
        schema_version: 1,
        checksum: stableChecksum(cloned),
        estimated_wh_min: est.estimatedWhMin,
        estimated_wh_max: est.estimatedWhMax,
        created_by_user_id: user.id,
      })
      .select("*")
      .single();
    if (verErr) throw verErr;

    await client
      .from("playbooks")
      .update({ current_version_id: version.id })
      .eq("id", playbook.id);

    return NextResponse.json({
      ok: true,
      playbook: { ...playbook, current_version_id: version.id },
      version,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook clone]", error);
    return NextResponse.json({ ok: false, error: "Unable to clone playbook." }, { status: 500 });
  }
}
