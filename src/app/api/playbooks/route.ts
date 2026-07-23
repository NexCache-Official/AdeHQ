import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  isCustomPlaybooksV1Enabled,
  isPlaybookRuntimeV1Enabled,
} from "@/lib/playbooks/flags";
import {
  catalogItemFromSeed,
  listPublishedSeedCatalog,
  type PlaybookListItem,
} from "@/lib/playbooks/api-helpers";
import { estimatePlaybookWh } from "@/lib/playbooks/estimator";
import { listPlaybooks } from "@/lib/playbooks/repository";
import { PLATFORM_PLAYBOOK_SEEDS } from "@/lib/playbooks/seeds";
import type { PlaybookDefinitionV1, PlaybookCategory } from "@/lib/playbooks/contracts";
import { stableChecksum } from "@/lib/playbooks/checksum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/playbooks?workspaceId=
 * When runtime OFF: published seed catalog (read-only).
 * When runtime ON: merge DB rows with seeds not yet persisted.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);

    if (!isPlaybookRuntimeV1Enabled()) {
      return NextResponse.json({
        ok: true,
        runtimeEnabled: false,
        playbooks: listPublishedSeedCatalog(),
      });
    }

    const dbRows = await listPlaybooks(client, { workspaceId, status: "published" }).catch(
      () => [],
    );
    const byKey = new Map<string, PlaybookListItem>();

    for (const seed of PLATFORM_PLAYBOOK_SEEDS) {
      if ((seed.status ?? "published") !== "published") continue;
      byKey.set(seed.key, catalogItemFromSeed(seed));
    }

    for (const row of dbRows) {
      const estimate =
        row.current_version_id == null
          ? null
          : await client
              .from("playbook_versions")
              .select("definition, estimated_wh_min, estimated_wh_max")
              .eq("id", row.current_version_id)
              .maybeSingle();

      const definition = (estimate?.data?.definition ?? null) as PlaybookDefinitionV1 | null;
      const fallback = definition ? estimatePlaybookWh(definition) : null;
      byKey.set(row.key, {
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        category: row.category,
        industryTags: row.industry_tags ?? [],
        visibility: row.visibility,
        status: row.status,
        source: "database",
        estimatedWhMin:
          estimate?.data?.estimated_wh_min != null
            ? Number(estimate.data.estimated_wh_min)
            : (fallback?.estimatedWhMin ?? null),
        estimatedWhMax:
          estimate?.data?.estimated_wh_max != null
            ? Number(estimate.data.estimated_wh_max)
            : (fallback?.estimatedWhMax ?? null),
        stepCount: definition?.steps?.length ?? 0,
        roleCount: definition?.roleRequirements?.length ?? 0,
        definition: definition ?? undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      runtimeEnabled: true,
      playbooks: Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbooks GET]", error);
    return NextResponse.json({ ok: false, error: "Unable to list playbooks." }, { status: 500 });
  }
}

type CreatePlaybookBody = {
  workspaceId?: string;
  key?: string;
  name?: string;
  description?: string;
  category?: PlaybookCategory;
  definition?: PlaybookDefinitionV1;
};

/** POST creates a workspace draft playbook (custom playbooks flag). */
export async function POST(request: NextRequest) {
  try {
    if (!isCustomPlaybooksV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Custom playbooks are disabled (ADEHQ_CUSTOM_PLAYBOOKS_V1)." },
        { status: 403 },
      );
    }
    if (!isPlaybookRuntimeV1Enabled()) {
      return NextResponse.json(
        { ok: false, error: "Playbook runtime is disabled (ADEHQ_PLAYBOOK_RUNTIME_V1)." },
        { status: 403 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as CreatePlaybookBody;
    if (!body.workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }
    if (!body.key?.trim() || !body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "key and name are required." }, { status: 400 });
    }
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const definition: PlaybookDefinitionV1 =
      body.definition ??
      ({
        schemaVersion: 1,
        key: body.key.trim(),
        name: body.name.trim(),
        description: body.description,
        category: body.category ?? "general",
        roleRequirements: [],
        inputs: [],
        steps: [],
        outputs: [],
        successChecks: [{ type: "all_steps_completed" }],
        policies: { hardWhLimit: 4, collaborationMaxLevel: 1 },
      } satisfies PlaybookDefinitionV1);

    const { data: playbook, error } = await client
      .from("playbooks")
      .insert({
        workspace_id: body.workspaceId,
        key: body.key.trim(),
        name: body.name.trim(),
        description: body.description ?? null,
        category: body.category ?? definition.category ?? "general",
        visibility: "workspace",
        status: "draft",
        created_by_user_id: user.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    const est = estimatePlaybookWh(definition);
    const { data: version, error: verErr } = await client
      .from("playbook_versions")
      .insert({
        playbook_id: playbook.id,
        version: 1,
        definition,
        schema_version: 1,
        checksum: stableChecksum(definition),
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

    return NextResponse.json({ ok: true, playbook: { ...playbook, current_version_id: version.id }, version });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbooks POST]", error);
    return NextResponse.json({ ok: false, error: "Unable to create playbook." }, { status: 500 });
  }
}
