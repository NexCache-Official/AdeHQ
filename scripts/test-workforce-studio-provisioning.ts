/**
 * PR-21B live-DB regression: full blueprint lifecycle against the linked
 * Supabase project — compose → draft lock/patch → approve (canonical hash
 * freeze) → provision (batched idempotent executor) → verify provisioned
 * rows + provenance → forced step failure → compensation rollback →
 * idempotent re-provision of a second, clean blueprint.
 *
 * Run: npm run test:workforce-studio:provisioning
 * Requires SUPABASE_SECRET_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local.
 */
import "dotenv/config";
import { createSupabaseSecretClient } from "../src/lib/supabase/server";
import { composeBlueprintFromTemplate } from "../src/lib/hiring/workforce-studio/composer";
import { getTemplateManifest } from "../src/lib/hiring/workforce-studio/templates/registry";
import {
  createDraftBlueprint,
  acquireBlueprintLock,
  patchDraftBlueprint,
  approveBlueprint,
  getBlueprint,
  BlueprintRevisionConflictError,
} from "../src/lib/hiring/workforce-studio/blueprint-service";
import { runSimulation } from "../src/lib/hiring/workforce-studio/simulation";
import { createHirePlan, advanceHirePlan } from "../src/lib/hiring/workforce-studio/plan-service";
import type { WorkforceBlueprintPayload } from "../src/lib/hiring/workforce-studio/types";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    failures += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

async function main() {
  const service = createSupabaseSecretClient();

  const { data: authUser, error: authError } = await service.auth.admin.createUser({
    email: `workforce-studio-test-${Date.now()}@adehq.test`,
    password: `Test-${Math.random().toString(36).slice(2)}!A1`,
    email_confirm: true,
  });
  if (authError || !authUser?.user) throw authError ?? new Error("Failed to create test auth user.");
  const userId = authUser.user.id;

  const { data: workspace, error: wsError } = await service
    .from("workspaces")
    .insert({ name: "Workforce Studio Test Co", owner_id: userId, onboarding_complete: true })
    .select("id")
    .single();
  if (wsError || !workspace) throw wsError ?? new Error("Failed to create test workspace.");
  const workspaceId = workspace.id as string;

  await service.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "admin" });

  console.log(`\nUsing ephemeral workspace ${workspaceId}\n`);

  try {
    await runLifecycleTest(service, workspaceId, userId);
    await runCompensationTest(service, workspaceId, userId);
    await runIdempotentReprovisionTest(service, workspaceId, userId);
    await runRetryAfterFailureTest(service, workspaceId, userId);
    await runSeatCountMatrixTest(service, workspaceId, userId);
  } finally {
    console.log("\nCleaning up ephemeral workspace + user...");
    await service.from("workspaces").delete().eq("id", workspaceId);
    await service.auth.admin.deleteUser(userId);
  }

  console.log(`\n${failures === 0 ? "All Workforce Studio provisioning tests passed." : `${failures} test(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function runLifecycleTest(service: ReturnType<typeof createSupabaseSecretClient>, workspaceId: string, userId: string) {
  console.log("=== Full lifecycle: compose → lock → patch → approve → provision → complete ===\n");

  const manifest = getTemplateManifest("software_house")!;
  const payload = composeBlueprintFromTemplate(manifest, { team_size_preference: "lean" }, null);
  const blueprint = await createDraftBlueprint(service, {
    workspaceId,
    createdBy: userId,
    name: "Lean Software House",
    templateKey: manifest.key,
    templateVersion: manifest.version,
    payload,
  });
  assert(blueprint.status === "draft", "new blueprint starts as draft");
  assert(blueprint.revision === 1, "new blueprint starts at revision 1");

  // Draft lock + optimistic concurrency.
  const lock = await acquireBlueprintLock(service, workspaceId, blueprint.id, userId);
  assert(Boolean(lock.lockToken), "lock acquired");

  // Same-user heartbeat must extend TTL without rotating the token — otherwise
  // Approve/Save racing a refresh surfaces "Someone else is currently editing".
  const refreshed = await acquireBlueprintLock(service, workspaceId, blueprint.id, userId);
  assert(
    refreshed.lockToken === lock.lockToken,
    `same-user lock refresh keeps token (was ${lock.lockToken}, got ${refreshed.lockToken})`,
  );
  assert(
    new Date(refreshed.lockExpiresAt).getTime() >= new Date(lock.lockExpiresAt).getTime(),
    "same-user lock refresh extends or preserves expiry",
  );

  const renamedPayload = { ...blueprint.draftPayload, notes: "Edited via test" };
  const patched = await patchDraftBlueprint(service, {
    workspaceId,
    blueprintId: blueprint.id,
    userId,
    lockToken: lock.lockToken,
    expectedRevision: blueprint.revision,
    payload: renamedPayload,
    changeSummary: "Added notes",
  });
  assert(patched.revision === 2, `patch bumps revision to 2 (got ${patched.revision})`);

  // Stale revision must be rejected.
  let staleRejected = false;
  try {
    await patchDraftBlueprint(service, {
      workspaceId,
      blueprintId: blueprint.id,
      userId,
      lockToken: lock.lockToken,
      expectedRevision: 1, // stale on purpose
      payload: renamedPayload,
      changeSummary: "Stale attempt",
    });
  } catch (error) {
    staleRejected = error instanceof BlueprintRevisionConflictError;
  }
  assert(staleRejected, "stale revision patch is rejected with BlueprintRevisionConflictError");

  // Simulation.
  const report = runSimulation(patched.draftPayload, manifest.scenarios, patched.revision);
  assert(report.workHoursForecast.length === patched.draftPayload.seats.length, "WH forecast covers every seat");
  assert(report.totalExpectedWeeklyWh > 0, "WH forecast total is positive");
  assert(
    report.workHoursForecast.every((band) => band.byCapability.length > 0),
    "every seat's WH forecast breaks down by capability domain",
  );
  assert(
    report.workHoursForecast.every((band) => {
      const sum = band.byCapability.reduce((s, slice) => s + slice.expectedWh, 0);
      return Math.abs(sum - band.expectedWh) < 0.5;
    }),
    "per-capability WH slices sum back to the seat's expected WH",
  );

  // Approve — freezes canonical hash.
  const approved = await approveBlueprint(service, {
    workspaceId,
    blueprintId: blueprint.id,
    userId,
    lockToken: lock.lockToken,
    expectedRevision: patched.revision,
  });
  assert(approved.status === "approved", "blueprint approved");
  assert(Boolean(approved.approvalHash), "approval hash computed");
  assert(approved.approvedRevision === patched.revision, "approvedRevision matches the revision that was approved");

  // Provision.
  const { plan, steps } = await createHirePlan(service, { workspaceId, blueprintId: blueprint.id, userId });
  assert(plan.status === "pending", "plan starts pending");
  assert(steps.length > 0, `plan has steps (${steps.length})`);

  let current = { plan, steps };
  let iterations = 0;
  while (!["completed", "failed", "compensated"].includes(current.plan.status) && iterations < 20) {
    current = await advanceHirePlan(service, { workspaceId, planId: plan.id });
    iterations += 1;
  }
  assert(current.plan.status === "completed", `plan completes (status=${current.plan.status}, iterations=${iterations})`);
  assert(
    current.steps.every((s) => s.status === "succeeded"),
    "every step succeeded",
  );

  // Verify provisioned rows + provenance.
  const { data: employees } = await service
    .from("ai_employees")
    .select("id, created_by_blueprint_id, created_by_plan_id")
    .eq("workspace_id", workspaceId);
  assert(
    (employees?.length ?? 0) === patched.draftPayload.seats.length,
    `ai_employees rows created for every seat (${employees?.length} / ${patched.draftPayload.seats.length})`,
  );
  assert(
    (employees ?? []).every((e) => e.created_by_blueprint_id === blueprint.id && e.created_by_plan_id === plan.id),
    "every provisioned employee carries blueprint + plan provenance",
  );

  const { data: rooms } = await service.from("rooms").select("id").eq("workspace_id", workspaceId);
  assert((rooms?.length ?? 0) === patched.draftPayload.rooms.length, "rooms created for every planned room");

  const { data: artifacts } = await service.from("artifacts").select("id, artifact_type").eq("workspace_id", workspaceId);
  assert(
    (artifacts ?? []).some((a) => a.artifact_type === "team_charter"),
    "Team Charter artifact created",
  );
  assert(
    (artifacts ?? []).filter((a) => a.artifact_type === "role_scorecard").length === patched.draftPayload.seats.length,
    "one Role Scorecard artifact per seat",
  );

  const { data: tasks } = await service.from("tasks").select("id").eq("workspace_id", workspaceId);
  assert((tasks?.length ?? 0) > 0, "first-mission / outcome tasks created");

  const { data: messages } = await service.from("messages").select("id").eq("workspace_id", workspaceId);
  assert((messages?.length ?? 0) === patched.draftPayload.seats.length, "one welcome message per seat");

  const { data: edges } = await service.from("work_graph_edges").select("id").eq("workspace_id", workspaceId);
  assert((edges?.length ?? 0) === patched.draftPayload.edges.length, "work graph edges created for every collaboration edge");

  // Re-provisioning the same approved revision must be a no-op (idempotent).
  const second = await createHirePlan(service, { workspaceId, blueprintId: blueprint.id, userId });
  assert(second.plan.id === plan.id, "re-provisioning the same approved revision reuses the same plan (idempotency key)");

  const finalBlueprint = await getBlueprint(service, workspaceId, blueprint.id);
  assert(finalBlueprint.status === "active", "blueprint status becomes active once provisioning completes");
}

async function runCompensationTest(service: ReturnType<typeof createSupabaseSecretClient>, workspaceId: string, userId: string) {
  console.log("\n=== Forced failure → compensation rollback ===\n");

  const manifest = getTemplateManifest("general_ops")!;
  const payload = composeBlueprintFromTemplate(manifest, { team_size_preference: "lean" }, null);
  const blueprint = await createDraftBlueprint(service, {
    workspaceId,
    createdBy: userId,
    name: "Ops team (forced failure)",
    templateKey: manifest.key,
    templateVersion: manifest.version,
    payload,
  });
  const lock = await acquireBlueprintLock(service, workspaceId, blueprint.id, userId);
  const approved = await approveBlueprint(service, {
    workspaceId,
    blueprintId: blueprint.id,
    userId,
    lockToken: lock.lockToken,
    expectedRevision: blueprint.revision,
  });

  const { plan } = await createHirePlan(service, { workspaceId, blueprintId: blueprint.id, userId });

  // Corrupt one "create_employee" step so its DB write fails deterministically
  // (violate the not-null role_key by pointing at a bogus seat id — the
  // executor will throw "Unknown seat", exhaust retries, and compensate).
  const { data: employeeSteps } = await service
    .from("team_hire_plan_steps")
    .select("id")
    .eq("plan_id", plan.id)
    .eq("step_type", "create_employee")
    .limit(1);
  const targetStepId = employeeSteps?.[0]?.id;
  assert(Boolean(targetStepId), "found a create_employee step to corrupt");
  await service.from("team_hire_plan_steps").update({ payload: { seatId: "does-not-exist" } }).eq("id", targetStepId);

  let current = await advanceHirePlan(service, { workspaceId, planId: plan.id });
  let iterations = 0;
  while (!["failed", "compensated", "completed"].includes(current.plan.status) && iterations < 20) {
    current = await advanceHirePlan(service, { workspaceId, planId: plan.id });
    iterations += 1;
  }
  assert(current.plan.status === "compensated", `plan lands in compensated state after exhausting retries (got ${current.plan.status})`);

  const compensatedFailedStep = current.steps.find((s) => s.payload.seatId === "does-not-exist");
  assert(compensatedFailedStep?.status === "failed", "the corrupted step itself is marked failed, not compensated");
  assert(
    current.steps.filter((s) => s.status === "succeeded").length === 0,
    "no steps remain in succeeded state after compensation (all rolled back or never ran)",
  );

  // Every succeeded room/employee/etc. must have been deleted by compensation.
  const { data: leftoverEmployees } = await service
    .from("ai_employees")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", payload.seats.map((s) => s.id));
  assert((leftoverEmployees?.length ?? 0) === 0, "compensation removed every provisioned employee for the failed plan");

  const { data: leftoverRooms } = await service
    .from("rooms")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", payload.rooms.map((r) => r.id));
  assert((leftoverRooms?.length ?? 0) === 0, "compensation removed every provisioned room for the failed plan");

  void approved;
}

async function runIdempotentReprovisionTest(
  service: ReturnType<typeof createSupabaseSecretClient>,
  workspaceId: string,
  userId: string,
) {
  console.log("\n=== Clean blueprint provisions correctly after a prior failure elsewhere ===\n");

  const manifest = getTemplateManifest("saas_startup")!;
  const payload = composeBlueprintFromTemplate(manifest, { team_size_preference: "standard" }, null);
  const blueprint = await createDraftBlueprint(service, {
    workspaceId,
    createdBy: userId,
    name: "SaaS team (clean)",
    templateKey: manifest.key,
    templateVersion: manifest.version,
    payload,
  });
  const lock = await acquireBlueprintLock(service, workspaceId, blueprint.id, userId);
  await approveBlueprint(service, {
    workspaceId,
    blueprintId: blueprint.id,
    userId,
    lockToken: lock.lockToken,
    expectedRevision: blueprint.revision,
  });
  const { plan } = await createHirePlan(service, { workspaceId, blueprintId: blueprint.id, userId });

  let current = await advanceHirePlan(service, { workspaceId, planId: plan.id });
  let iterations = 0;
  while (current.plan.status !== "completed" && iterations < 20) {
    current = await advanceHirePlan(service, { workspaceId, planId: plan.id });
    iterations += 1;
  }
  assert(current.plan.status === "completed", "an unrelated clean blueprint still provisions fully after a prior compensation elsewhere");
}

/** Duplicate the last seat in a composed payload until it has exactly
 * `targetCount` seats — used to synthesize the 20-seat stress case without a
 * template author having to hand-write a 20-role manifest. Clones stay in
 * the same primary room and inherit the same authority policy, so the
 * resulting payload remains structurally valid (every extra seat is still a
 * room member, no dangling references). */
function padSeatsTo(payload: WorkforceBlueprintPayload, targetCount: number): WorkforceBlueprintPayload {
  if (payload.seats.length >= targetCount) return payload;
  const template = payload.seats[payload.seats.length - 1];
  const newSeats = [...payload.seats];
  let rooms = payload.rooms;
  let i = newSeats.length;
  while (newSeats.length < targetCount) {
    i += 1;
    const clone = {
      ...template,
      id: `${template.id}-pad-${i}`,
      operationalVariant: `Pad ${i}`,
      mission: `${template.mission} (padded seat ${i} for stress testing).`,
    };
    newSeats.push(clone);
    if (clone.primaryRoomId) {
      rooms = rooms.map((r) => (r.id === clone.primaryRoomId ? { ...r, memberSeatIds: [...r.memberSeatIds, clone.id] } : r));
    }
  }
  return { ...payload, seats: newSeats, rooms };
}

async function provisionToCompletion(
  service: ReturnType<typeof createSupabaseSecretClient>,
  workspaceId: string,
  planId: string,
  maxIterations = 40,
) {
  let current = await advanceHirePlan(service, { workspaceId, planId });
  let iterations = 1;
  while (!["completed", "failed", "compensated", "cancelled"].includes(current.plan.status) && iterations < maxIterations) {
    current = await advanceHirePlan(service, { workspaceId, planId });
    iterations += 1;
  }
  return { ...current, iterations };
}

async function runRetryAfterFailureTest(
  service: ReturnType<typeof createSupabaseSecretClient>,
  workspaceId: string,
  userId: string,
) {
  console.log("\n=== Retry after failure — same blueprint, new attempt, no duplicate resources ===\n");

  const manifest = getTemplateManifest("general_ops")!;
  const payload = composeBlueprintFromTemplate(manifest, { team_size_preference: "lean" }, null);
  const blueprint = await createDraftBlueprint(service, {
    workspaceId,
    createdBy: userId,
    name: "Ops team (retry after failure)",
    templateKey: manifest.key,
    templateVersion: manifest.version,
    payload,
  });
  const lock = await acquireBlueprintLock(service, workspaceId, blueprint.id, userId);
  await approveBlueprint(service, {
    workspaceId,
    blueprintId: blueprint.id,
    userId,
    lockToken: lock.lockToken,
    expectedRevision: blueprint.revision,
  });

  // First attempt — corrupt a step so it fails and compensates.
  const first = await createHirePlan(service, { workspaceId, blueprintId: blueprint.id, userId });
  const { data: employeeSteps } = await service
    .from("team_hire_plan_steps")
    .select("id")
    .eq("plan_id", first.plan.id)
    .eq("step_type", "create_employee")
    .limit(1);
  await service.from("team_hire_plan_steps").update({ payload: { seatId: "does-not-exist" } }).eq("id", employeeSteps?.[0]?.id);

  const firstResult = await provisionToCompletion(service, workspaceId, first.plan.id);
  assert(firstResult.plan.status === "compensated", `first attempt compensates on the corrupted step (got ${firstResult.plan.status})`);

  const { data: leftoverAfterFirst } = await service
    .from("ai_employees")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", payload.seats.map((s) => s.id));
  assert((leftoverAfterFirst?.length ?? 0) === 0, "first attempt's employees fully rolled back before retry");

  // Retry — createHirePlan for the same blueprint/revision must start a
  // fresh, distinct attempt (not hand back the dead compensated plan).
  const retry = await createHirePlan(service, { workspaceId, blueprintId: blueprint.id, userId });
  assert(retry.plan.id !== first.plan.id, "retry creates a new plan, not the dead compensated one");
  assert(
    retry.plan.idempotencyKey !== first.plan.idempotencyKey,
    "retry plan has a distinct idempotency key from the failed attempt",
  );

  const retryResult = await provisionToCompletion(service, workspaceId, retry.plan.id);
  assert(retryResult.plan.status === "completed", `retry attempt completes cleanly (got ${retryResult.plan.status})`);

  const { data: finalEmployees } = await service
    .from("ai_employees")
    .select("id, created_by_plan_id")
    .eq("workspace_id", workspaceId)
    .in("id", payload.seats.map((s) => s.id));
  assert(
    (finalEmployees?.length ?? 0) === payload.seats.length,
    `retry provisioned exactly one employee per seat, no duplicates (${finalEmployees?.length} / ${payload.seats.length})`,
  );
  assert(
    (finalEmployees ?? []).every((e) => e.created_by_plan_id === retry.plan.id),
    "surviving employees all carry the retry plan's provenance, not the failed attempt's",
  );

  const { data: finalRooms } = await service
    .from("rooms")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", payload.rooms.map((r) => r.id));
  assert((finalRooms?.length ?? 0) === payload.rooms.length, "retry provisioned exactly one room per planned room, no duplicates");

  const { data: finalMessages } = await service
    .from("messages")
    .select("id")
    .in(
      "room_id",
      payload.rooms.map((r) => r.id),
    );
  assert(
    (finalMessages?.length ?? 0) === payload.seats.length,
    `retry created exactly one welcome message per seat, no duplicates (${finalMessages?.length} / ${payload.seats.length})`,
  );
}

async function runSeatCountMatrixTest(
  service: ReturnType<typeof createSupabaseSecretClient>,
  workspaceId: string,
  userId: string,
) {
  console.log("\n=== Full E2E seat-count matrix: 2, 5, 20 seats ===\n");

  const cases: { label: string; templateKey: string; sizePref: string; targetSeats: number }[] = [
    { label: "2-seat", templateKey: "general_ops", sizePref: "lean", targetSeats: 2 },
    { label: "5-seat", templateKey: "saas_startup", sizePref: "standard", targetSeats: 5 },
    { label: "20-seat", templateKey: "software_house", sizePref: "scaled", targetSeats: 20 },
  ];

  for (const testCase of cases) {
    const manifest = getTemplateManifest(testCase.templateKey)!;
    // Only the 20-seat software_house case needs the extra scaling
    // rules (DevOps + support seats) switched on to get closer to its
    // target before padding; other templates stay at their plain defaults
    // so their native base+scaling seat count isn't perturbed.
    const extraAnswers =
      testCase.templateKey === "software_house"
        ? { needs_dedicated_devops: "yes", needs_customer_support: "yes" }
        : {};
    const composed = composeBlueprintFromTemplate(
      manifest,
      { team_size_preference: testCase.sizePref, ...extraAnswers },
      null,
    );
    const payload = padSeatsTo(composed, testCase.targetSeats);
    assert(
      payload.seats.length === testCase.targetSeats,
      `${testCase.label} payload has exactly ${testCase.targetSeats} seats (got ${payload.seats.length})`,
    );

    const blueprint = await createDraftBlueprint(service, {
      workspaceId,
      createdBy: userId,
      name: `${testCase.label} matrix team`,
      templateKey: manifest.key,
      templateVersion: manifest.version,
      payload,
    });
    const lock = await acquireBlueprintLock(service, workspaceId, blueprint.id, userId);
    const approved = await approveBlueprint(service, {
      workspaceId,
      blueprintId: blueprint.id,
      userId,
      lockToken: lock.lockToken,
      expectedRevision: blueprint.revision,
    });
    assert(approved.status === "approved", `${testCase.label} blueprint approved`);

    const { plan, steps } = await createHirePlan(service, { workspaceId, blueprintId: blueprint.id, userId });
    const result = await provisionToCompletion(service, workspaceId, plan.id, 60);
    assert(
      result.plan.status === "completed",
      `${testCase.label} plan completes (status=${result.plan.status}, steps=${steps.length}, batches=${result.iterations})`,
    );

    const { data: employees } = await service
      .from("ai_employees")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("id", payload.seats.map((s) => s.id));
    assert(
      (employees?.length ?? 0) === payload.seats.length,
      `${testCase.label}: ai_employees created for every seat (${employees?.length} / ${payload.seats.length})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
