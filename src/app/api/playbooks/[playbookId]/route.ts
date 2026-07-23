import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  isCustomPlaybooksV1Enabled,
  isPlaybookRuntimeV1Enabled,
} from "@/lib/playbooks/flags";
import {
  catalogItemFromSeed,
  isSeedPlaybookId,
  resolveSeedDefinition,
} from "@/lib/playbooks/api-helpers";
import { estimatePlaybookWh } from "@/lib/playbooks/estimator";
import { getPlaybook } from "@/lib/playbooks/repository";
import type { PlaybookDefinitionV1, PlaybookStatus } from "@/lib/playbooks/contracts";
import { createPlaybookVersion } from "@/lib/playbooks/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { playbookId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const playbookId = params.playbookId;

    if (isSeedPlaybookId(playbookId) || !isPlaybookRuntimeV1Enabled()) {
      const def = resolveSeedDefinition(playbookId);
      if (!def) {
        return NextResponse.json({ ok: false, error: "Playbook not found." }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        runtimeEnabled: isPlaybookRuntimeV1Enabled(),
        playbook: catalogItemFromSeed(def),
        version: null,
        definition: def,
        estimate: estimatePlaybookWh(def),
      });
    }

    const loaded = await getPlaybook(client, playbookId);
    if (!loaded) {
      const def = resolveSeedDefinition(playbookId);
      if (!def) {
        return NextResponse.json({ ok: false, error: "Playbook not found." }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        runtimeEnabled: true,
        playbook: catalogItemFromSeed(def),
        version: null,
        definition: def,
        estimate: estimatePlaybookWh(def),
      });
    }

    const { playbook, version } = loaded;
    if (
      playbook.workspace_id &&
      playbook.workspace_id !== workspaceId &&
      playbook.visibility !== "platform"
    ) {
      return NextResponse.json({ ok: false, error: "Playbook not found." }, { status: 404 });
    }

    const definition = (version?.definition ?? null) as PlaybookDefinitionV1 | null;
    return NextResponse.json({
      ok: true,
      runtimeEnabled: true,
      playbook,
      version,
      definition,
      estimate: definition ? estimatePlaybookWh(definition) : null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook GET]", error);
    return NextResponse.json({ ok: false, error: "Unable to load playbook." }, { status: 500 });
  }
}

type PatchBody = {
  workspaceId?: string;
  name?: string;
  description?: string | null;
  category?: string;
  status?: PlaybookStatus;
  definition?: PlaybookDefinitionV1;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { playbookId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled() || !isCustomPlaybooksV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Playbook editing is disabled." },
        { status: 403 },
      );
    }
    if (isSeedPlaybookId(params.playbookId)) {
      return NextResponse.json(
        { ok: false, error: "Platform seed playbooks are read-only. Clone first." },
        { status: 403 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as PatchBody;
    if (!body.workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const loaded = await getPlaybook(client, params.playbookId);
    if (!loaded || loaded.playbook.workspace_id !== body.workspaceId) {
      return NextResponse.json({ ok: false, error: "Playbook not found." }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description;
    if (body.category !== undefined) patch.category = body.category;
    if (body.status !== undefined) patch.status = body.status;

    if (Object.keys(patch).length) {
      const { error } = await client.from("playbooks").update(patch).eq("id", params.playbookId);
      if (error) throw error;
    }

    let version = loaded.version;
    if (body.definition) {
      const nextVersion = (loaded.version?.version ?? 0) + 1;
      const est = estimatePlaybookWh(body.definition);
      version = await createPlaybookVersion(client, {
        playbookId: params.playbookId,
        version: nextVersion,
        definition: body.definition,
        estimatedWhMin: est.estimatedWhMin,
        estimatedWhMax: est.estimatedWhMax,
        createdByUserId: user.id,
        setAsCurrent: true,
      });
    }

    const refreshed = await getPlaybook(client, params.playbookId);
    return NextResponse.json({
      ok: true,
      playbook: refreshed?.playbook,
      version: refreshed?.version ?? version,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook PATCH]", error);
    return NextResponse.json({ ok: false, error: "Unable to update playbook." }, { status: 500 });
  }
}
