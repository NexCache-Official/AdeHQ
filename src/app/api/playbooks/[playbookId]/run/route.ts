import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";
import {
  isSeedPlaybookId,
  resolveSeedDefinition,
  seedKeyFromPlaybookId,
} from "@/lib/playbooks/api-helpers";
import { createPlaybookRunEnvelope } from "@/lib/playbooks/executor";
import { matchPlaybookRoles } from "@/lib/playbooks/role-matcher";
import { buildIdempotencyKey } from "@/lib/playbooks/idempotency";
import { stableChecksum } from "@/lib/playbooks/checksum";
import { estimatePlaybookWh } from "@/lib/playbooks/estimator";
import {
  createPlaybookRun,
  createPlaybookVersion,
  getPlaybook,
  getPlaybookRun,
  upsertPlaybookRunStep,
} from "@/lib/playbooks/repository";
import type {
  PlaybookDefinitionV1,
  PlaybookRoleAssignment,
  PlaybookRoleCandidate,
} from "@/lib/playbooks/contracts";
import { createBrainRun } from "@/lib/brain/decisions/persist";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { loadPlaybookRoleCandidates } from "@/lib/playbooks/runtime/load-candidates";
import {
  getPlaybookWorkerMode,
  processPlaybookRunWave,
} from "@/lib/playbooks/runtime/process-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunBody = {
  workspaceId?: string;
  roomId?: string | null;
  topicId?: string | null;
  workItemId?: string | null;
  inputPayload?: Record<string, unknown>;
  selectedEmployeeIds?: string[];
  roleAssignments?: PlaybookRoleAssignment[];
  candidates?: PlaybookRoleCandidate[];
  idempotencyKey?: string;
  hardWhLimit?: number;
  intensity?: "low" | "standard" | "high";
};

async function ensureDbPlaybook(
  client: Awaited<ReturnType<typeof requireAuthUser>>["client"],
  playbookId: string,
  userId: string,
): Promise<{ playbookId: string; versionId: string; definition: PlaybookDefinitionV1 }> {
  if (!isSeedPlaybookId(playbookId)) {
    const loaded = await getPlaybook(client, playbookId);
    if (loaded?.version?.definition) {
      return {
        playbookId: loaded.playbook.id,
        versionId: loaded.version.id,
        definition: loaded.version.definition as PlaybookDefinitionV1,
      };
    }
  }

  const key = isSeedPlaybookId(playbookId) ? seedKeyFromPlaybookId(playbookId) : playbookId;
  const definition = resolveSeedDefinition(playbookId) ?? resolveSeedDefinition(key);
  if (!definition) {
    throw new AuthError("Playbook not found.", 404);
  }

  // Platform seed materialization uses service role (RLS blocks null workspace inserts).
  const service = createSupabaseSecretClient();

  const { data: existing } = await service
    .from("playbooks")
    .select("id, current_version_id")
    .is("workspace_id", null)
    .eq("key", definition.key)
    .maybeSingle();

  if (existing?.id && existing.current_version_id) {
    return {
      playbookId: existing.id,
      versionId: existing.current_version_id,
      definition,
    };
  }

  const { data: playbook, error } = await service
    .from("playbooks")
    .insert({
      workspace_id: null,
      key: definition.key,
      name: definition.name,
      description: definition.description ?? null,
      category: definition.category,
      industry_tags: definition.industryTags ?? [],
      visibility: "platform",
      status: "published",
      created_by_user_id: userId,
    })
    .select("*")
    .single();
  if (error) throw error;

  const est = estimatePlaybookWh(definition);
  const version = await createPlaybookVersion(service, {
    playbookId: playbook.id,
    version: 1,
    definition,
    estimatedWhMin: est.estimatedWhMin,
    estimatedWhMax: est.estimatedWhMax,
    createdByUserId: userId,
    setAsCurrent: true,
  });

  return { playbookId: playbook.id, versionId: version.id, definition };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { playbookId: string } },
) {
  try {
    if (!isPlaybookRuntimeV1Enabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Playbook runtime is disabled (ADEHQ_PLAYBOOK_RUNTIME_V1).",
        },
        { status: 403 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as RunBody;
    if (!body.workspaceId) {
      return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    if (body.roomId) {
      await assertCanAccessRoom(client, body.workspaceId, body.roomId, user.id, role);
    }

    const resolved = await ensureDbPlaybook(client, params.playbookId, user.id);
    const definition = resolved.definition;

    let candidates: PlaybookRoleCandidate[] = body.candidates ?? [];
    if (!body.roleAssignments?.length && !candidates.length) {
      candidates = await loadPlaybookRoleCandidates(client, {
        workspaceId: body.workspaceId,
        employeeIds: body.selectedEmployeeIds?.length
          ? body.selectedEmployeeIds
          : undefined,
      });
    } else if (!body.roleAssignments?.length && body.selectedEmployeeIds?.length && !body.candidates?.length) {
      // Selected IDs without tags — enrich from workspace roster.
      candidates = await loadPlaybookRoleCandidates(client, {
        workspaceId: body.workspaceId,
        employeeIds: body.selectedEmployeeIds,
      });
    }

    const roleAssignments =
      body.roleAssignments?.length
        ? body.roleAssignments
        : matchPlaybookRoles(definition.roleRequirements, candidates);

    const inputPayload = body.inputPayload ?? {};
    const envelope = createPlaybookRunEnvelope({
      definition,
      roleAssignments,
      inputPayload,
      status: definition.policies.requireApprovalBeforeStart ? "awaiting_approval" : "queued",
    });

    const idempotencyKey =
      body.idempotencyKey?.trim() ||
      buildIdempotencyKey([
        body.workspaceId,
        resolved.playbookId,
        resolved.versionId,
        user.id,
        stableChecksum(inputPayload),
      ]);

    const existing = await client
      .from("playbook_runs")
      .select("id")
      .eq("workspace_id", body.workspaceId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.data?.id) {
      const loaded = await getPlaybookRun(client, existing.data.id);
      return NextResponse.json({ ok: true, run: loaded?.run, steps: loaded?.steps ?? [], reused: true });
    }

    // Live integrity: brain_run wrap is required.
    const service = createSupabaseSecretClient();
    const brainRunId = await createBrainRun(service, {
      workspaceId: body.workspaceId,
      employeeId: roleAssignments[0]?.employeeId ?? null,
      roomId: body.roomId ?? null,
      topicId: body.topicId ?? null,
      intensity: body.intensity === "high" ? "deep" : body.intensity === "low" ? "fast" : "standard",
      metadata: {
        playbookId: resolved.playbookId,
        playbookKey: definition.key,
        source: "playbook_run",
      },
    });

    const selectedEmployeeIds = [
      ...new Set([
        ...(body.selectedEmployeeIds ?? []),
        ...roleAssignments.map((a) => a.employeeId),
      ]),
    ];

    // Persist with service role after auth/scope checks — avoids RLS write gaps
    // on playbook_run_steps and keeps live runs reliable in production.
    const run = await createPlaybookRun(service, {
      workspaceId: body.workspaceId,
      playbookId: resolved.playbookId,
      playbookVersionId: resolved.versionId,
      initiatedByUserId: user.id,
      idempotencyKey,
      brainRunId,
      roomId: body.roomId ?? null,
      topicId: body.topicId ?? null,
      workItemId: body.workItemId ?? null,
      status: envelope.status,
      inputPayload,
      estimatedWhMin: envelope.estimatedWhMin,
      estimatedWhMax: envelope.estimatedWhMax,
      hardWhLimit: body.hardWhLimit ?? envelope.hardWhLimit,
      selectedEmployeeIds,
      planSnapshot: envelope.plan as unknown as Record<string, unknown>,
    });

    const steps = [];
    for (const step of envelope.steps) {
      steps.push(
        await upsertPlaybookRunStep(service, {
          playbookRunId: run.id,
          stepKey: step.stepKey,
          status: step.status,
          assignedEmployeeId: step.employeeId,
          dependsOn: step.dependsOn,
          estimatedWh: step.estimatedWh,
        }),
      );
    }

    // Inline first wave when not in queue mode (default: inline).
    if (getPlaybookWorkerMode() !== "queue" && envelope.status === "queued") {
      void processPlaybookRunWave(service, {
        runId: run.id,
        serviceClient: service,
      }).catch((err) => {
        console.error("[AdeHQ playbook run] inline process wave failed", err);
      });
    }

    return NextResponse.json({
      ok: true,
      run,
      steps,
      envelope,
      reused: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ playbook run]", error);
    return NextResponse.json({ ok: false, error: "Unable to start playbook run." }, { status: 500 });
  }
}
