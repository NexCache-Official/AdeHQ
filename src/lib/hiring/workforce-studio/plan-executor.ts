// Durable, batched, idempotent provisioning saga (PR-21B). A team_hire_plan
// is built once from an APPROVED blueprint snapshot; steps are executed in
// small batches (bounded by count + wall-clock deadline) so a single
// serverless invocation can never time out mid-provision — the client polls
// /advance until the plan reports completed/failed.
//
// Every object created carries provenance (createdByBlueprintId,
// createdByBlueprintRevision, createdByPlanId) and every step is keyed by an
// id minted at plan-build time (not DB defaults), so re-attempting a step
// that already succeeded is never necessary and compensation can always
// find exactly what it created.

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { uid, nowISO } from "@/lib/utils";
import { INTERNAL_CAPABILITY_TOOL_IDS, CAPABILITY_DOMAINS } from "@/lib/integrations/registry/capabilities";
import type { CapabilityDomain } from "@/lib/integrations/types";
import { getRoleByKey } from "@/lib/hiring/role-library";
import { MAYA_EMPLOYEE_ID } from "@/lib/hiring/maya";
import { buildInterpolationContext, interpolate } from "./composer";
import { getTemplateManifest } from "./templates/registry";
import { authorityLevelRank } from "./simulation";
import { buildTeamCharterMarkdown, buildRoleScorecardMarkdown } from "./artifact-templates";
import type {
  AuthorityLevel,
  WorkforceBlueprintPayload,
  WorkforceBlueprintRecord,
  WorkforceSeat,
} from "./types";

export const MAX_STEPS_PER_BATCH = 10;
export const BATCH_DEADLINE_MS = 8000;

type StepInput = {
  stepType:
    | "create_room"
    | "create_employee"
    | "grant_tools"
    | "add_room_member"
    | "create_collaboration_edge"
    | "create_outcome_task"
    | "create_artifact"
    | "first_mission_task"
    | "first_mission_message";
  payload: Record<string, unknown>;
  dependsOn: number[];
};

function authorityToPermission(level: AuthorityLevel | undefined): "read" | "write" {
  return authorityLevelRank(level) >= authorityLevelRank("act_with_approval") ? "write" : "read";
}

/** Compile a seat's AuthorityPolicy into the existing AdeHQ permission model:
 * per-domain employee_tools grants + the two blanket approval flags AdeHQ
 * already enforces at runtime (approvalBeforeExternal / approvalBeforeEmails). */
function seatToolGrants(seat: WorkforceSeat): { toolId: string; permission: "read" | "write" }[] {
  const grants = new Map<string, "read" | "write">();
  for (const toolId of INTERNAL_CAPABILITY_TOOL_IDS) grants.set(toolId, "write");
  for (const [domain, info] of Object.entries(CAPABILITY_DOMAINS) as [CapabilityDomain, typeof CAPABILITY_DOMAINS[CapabilityDomain]][]) {
    const level = seat.authorityPolicy[domain as keyof typeof seat.authorityPolicy];
    if (!level) continue;
    const permission = authorityToPermission(level);
    const existing = grants.get(info.catalogToolId);
    if (!existing || (permission === "write" && existing === "read")) {
      grants.set(info.catalogToolId, permission);
    }
  }
  for (const toolId of seat.toolIds) {
    if (!grants.has(toolId)) grants.set(toolId, "read");
  }
  return [...grants.entries()].map(([toolId, permission]) => ({ toolId, permission }));
}

function seatEmployeeRow(
  workspaceId: string,
  seat: WorkforceSeat,
  blueprint: { id: string; approvedRevision: number | null },
  planId: string,
) {
  const roleEntry = getRoleByKey(seat.roleKey);
  const employeeRoleKey = roleEntry?.employeeRoleKey ?? "operations";
  const seniorityLabel =
    seat.seniority === "advisor"
      ? "Principal"
      : seat.seniority === "manager" || seat.seniority === "director"
        ? "Senior"
        : seat.seniority === "specialist"
          ? "Mid"
          : "Junior";

  return {
    workspace_id: workspaceId,
    id: seat.id,
    name: seat.roleTitle,
    role: seat.roleTitle,
    role_key: employeeRoleKey,
    provider: "siliconflow",
    model: "auto",
    model_mode: seat.modelMode,
    seniority: seniorityLabel,
    status: "idle",
    instructions: [
      seat.mission,
      seat.responsibilities.length ? `Responsibilities: ${seat.responsibilities.join("; ")}` : "",
      seat.successMetrics.length ? `Success metrics: ${seat.successMetrics.join("; ")}` : "",
      seat.personalityTraits.length ? `Personality: ${seat.personalityTraits.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    communication_style: seat.communicationStyle,
    success_criteria: seat.successMetrics.join("; ") || "Deliver on assigned responsibilities reliably.",
    permissions: {
      approvalBeforeExternal: authorityLevelRank(seat.authorityPolicy.email) < authorityLevelRank("act_autonomously"),
      approvalBeforeEmails: authorityLevelRank(seat.authorityPolicy.email) < authorityLevelRank("act_autonomously"),
    },
    memory_count: 0,
    tasks_completed: 0,
    messages_sent: 0,
    approvals_requested: 0,
    avg_response_time: "-",
    trust_score: seat.seniority === "advisor" ? 92 : seat.seniority === "specialist" ? 84 : 76,
    accent: "#f97316",
    default_room_id: seat.primaryRoomId ?? null,
    is_system_employee: false,
    system_employee_key: null,
    employee_kind: "workspace_employee",
    employee_access: "workspace",
    created_by_blueprint_id: blueprint.id,
    created_by_blueprint_revision: blueprint.approvedRevision,
    created_by_plan_id: planId,
    last_active_at: nowISO(),
    created_at: nowISO(),
  };
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

export function buildPlanSteps(payload: WorkforceBlueprintPayload): StepInput[] {
  const steps: StepInput[] = [];
  const roomStepIndex = new Map<string, number>();
  const employeeStepIndex = new Map<string, number>();

  for (const room of payload.rooms) {
    roomStepIndex.set(room.id, steps.length);
    steps.push({ stepType: "create_room", payload: { roomId: room.id }, dependsOn: [] });
  }

  for (const seat of payload.seats) {
    employeeStepIndex.set(seat.id, steps.length);
    steps.push({ stepType: "create_employee", payload: { seatId: seat.id }, dependsOn: [] });
  }

  for (const seat of payload.seats) {
    const empIdx = employeeStepIndex.get(seat.id)!;
    steps.push({ stepType: "grant_tools", payload: { seatId: seat.id }, dependsOn: [empIdx] });
  }

  for (const room of payload.rooms) {
    const roomIdx = roomStepIndex.get(room.id)!;
    for (const seatId of room.memberSeatIds) {
      const empIdx = employeeStepIndex.get(seatId);
      if (empIdx == null) continue;
      steps.push({
        stepType: "add_room_member",
        payload: { roomId: room.id, seatId },
        dependsOn: [roomIdx, empIdx],
      });
    }
  }

  for (const edge of payload.edges) {
    const fromIdx = employeeStepIndex.get(edge.fromSeatId);
    const toIdx = employeeStepIndex.get(edge.toSeatId);
    if (fromIdx == null || toIdx == null) continue;
    steps.push({
      stepType: "create_collaboration_edge",
      payload: { edgeId: edge.id, edgeRowId: randomUUID() },
      dependsOn: [fromIdx, toIdx],
    });
  }

  for (const outcome of payload.outcomes) {
    const ownerIdx = outcome.ownerSeatId ? employeeStepIndex.get(outcome.ownerSeatId) : undefined;
    steps.push({
      stepType: "create_outcome_task",
      payload: { outcomeId: outcome.id, taskId: uid("task") },
      dependsOn: ownerIdx != null ? [ownerIdx] : [],
    });
  }

  // Team Charter artifact — one per plan, no dependency (pure text).
  steps.push({
    stepType: "create_artifact",
    payload: { artifactKind: "team_charter", artifactId: randomUUID() },
    dependsOn: [],
  });

  // Role Scorecard artifacts — one per seat.
  for (const seat of payload.seats) {
    const empIdx = employeeStepIndex.get(seat.id)!;
    steps.push({
      stepType: "create_artifact",
      payload: { artifactKind: "role_scorecard", seatId: seat.id, artifactId: randomUUID() },
      dependsOn: [empIdx],
    });
  }

  // First Mission — template-defined tasks + a welcome message per seat.
  for (const seat of payload.seats) {
    const empIdx = employeeStepIndex.get(seat.id)!;
    steps.push({
      stepType: "first_mission_message",
      payload: { seatId: seat.id, messageId: uid("msg") },
      dependsOn: [empIdx],
    });
  }
  for (const mission of resolveFirstMissionTasks(payload)) {
    const empIdx = employeeStepIndex.get(mission.ownerSeatId);
    steps.push({
      stepType: "first_mission_task",
      payload: { ...mission, taskId: uid("task") },
      dependsOn: empIdx != null ? [empIdx] : [],
    });
  }

  return steps;
}

/** Resolve template firstMissionTasks (keyed by templateSeatId) against the
 * real composed seats. Matching is done positionally by role+variant since
 * the composer doesn't persist the templateSeatId on the final seat. */
function resolveFirstMissionTasks(payload: WorkforceBlueprintPayload) {
  const manifest = getTemplateManifest(payload.templateKey);
  if (!manifest) return [];
  const ctx = buildInterpolationContext(manifest, payload.intakeAnswers);

  const allBlueprints = [...manifest.baseSeats, ...manifest.scalingRules.flatMap((r) => r.addSeats ?? [])];
  const templateSeatIdByOrder = allBlueprints.map((b) => b.templateSeatId);

  return manifest.firstMissionTasks
    .map((mission) => {
      // Best-effort resolution: find the composed seat whose position in
      // payload.seats matches the template seat's position among the same
      // roleKey occurrences (stable given deterministic composition order).
      const templateBlueprint = allBlueprints.find((b) => b.templateSeatId === mission.ownerSeatTemplateId);
      if (!templateBlueprint) return null;
      const sameRoleTemplateIds = templateSeatIdByOrder.filter((id) => {
        const b = allBlueprints.find((x) => x.templateSeatId === id)!;
        return b.roleKey === templateBlueprint.roleKey;
      });
      const positionAmongRole = sameRoleTemplateIds.indexOf(mission.ownerSeatTemplateId);
      const composedSameRole = payload.seats.filter((s) => s.roleKey === templateBlueprint.roleKey);
      const ownerSeat = composedSameRole[positionAmongRole] ?? composedSameRole[0];
      if (!ownerSeat) return null;

      const due = new Date(Date.now() + mission.dueInDays * 24 * 60 * 60 * 1000).toISOString();
      return {
        ownerSeatId: ownerSeat.id,
        title: interpolate(mission.titleTemplate, ctx),
        description: interpolate(mission.descriptionTemplate, ctx),
        dueDate: due,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

// ---------------------------------------------------------------------------
// Step execution — one DB write per step, always idempotent via a
// pre-minted id, always tagged with provenance.
// ---------------------------------------------------------------------------

export async function executeStep(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    blueprint: WorkforceBlueprintRecord;
    planId: string;
    step: { stepType: StepInput["stepType"]; payload: Record<string, unknown> };
  },
): Promise<Record<string, unknown>> {
  const { workspaceId, blueprint, planId, step } = params;
  const payload = blueprint.approvedPayload;
  if (!payload) throw new Error("Blueprint has no approved payload to provision from.");

  switch (step.stepType) {
    case "create_room": {
      const room = payload.rooms.find((r) => r.id === step.payload.roomId);
      if (!room) throw new Error(`Unknown room ${step.payload.roomId}`);
      const { error } = await client.from("rooms").upsert(
        {
          workspace_id: workspaceId,
          id: room.id,
          name: room.name,
          kind: room.kind === "leadership" ? "room" : "room",
          description: room.description,
          brief: `Auto-created by Maya Workforce Studio (${blueprint.name}).`,
          room_visibility: room.visibility,
          accent: "#6366f1",
          status: "active",
          created_by_blueprint_id: blueprint.id,
          created_by_blueprint_revision: blueprint.approvedRevision,
          created_by_plan_id: planId,
        },
        { onConflict: "workspace_id,id" },
      );
      if (error) throw error;
      return { roomId: room.id };
    }

    case "create_employee": {
      const seat = payload.seats.find((s) => s.id === step.payload.seatId);
      if (!seat) throw new Error(`Unknown seat ${step.payload.seatId}`);
      const row = seatEmployeeRow(workspaceId, seat, blueprint, planId);
      const { error } = await client.from("ai_employees").upsert(row, { onConflict: "workspace_id,id" });
      if (error) throw error;
      return { seatId: seat.id };
    }

    case "grant_tools": {
      const seat = payload.seats.find((s) => s.id === step.payload.seatId);
      if (!seat) throw new Error(`Unknown seat ${step.payload.seatId}`);
      const grants = seatToolGrants(seat);
      const rows = grants.map((g) => ({
        workspace_id: workspaceId,
        employee_id: seat.id,
        tool_id: g.toolId,
        status: "connected",
        permission: g.permission,
        created_by_plan_id: planId,
      }));
      if (rows.length) {
        const { error } = await client
          .from("employee_tools")
          .upsert(rows, { onConflict: "workspace_id,employee_id,tool_id" });
        if (error) throw error;
      }
      return { seatId: seat.id, grantedToolIds: grants.map((g) => g.toolId) };
    }

    case "add_room_member": {
      const roomId = String(step.payload.roomId);
      const seatId = String(step.payload.seatId);
      const { error } = await client
        .from("room_members")
        .upsert(
          { workspace_id: workspaceId, room_id: roomId, member_type: "ai", member_id: seatId },
          { onConflict: "workspace_id,room_id,member_type,member_id" },
        );
      if (error) throw error;
      return { roomId, seatId };
    }

    case "create_collaboration_edge": {
      const edge = payload.edges.find((e) => e.id === step.payload.edgeId);
      if (!edge) throw new Error(`Unknown edge ${step.payload.edgeId}`);
      const { error } = await client.from("work_graph_edges").insert({
        id: step.payload.edgeRowId,
        workspace_id: workspaceId,
        from_object_type: "ai_employee",
        from_object_id: edge.fromSeatId,
        relation_type: edge.type,
        to_object_type: "ai_employee",
        to_object_id: edge.toSeatId,
        metadata: { description: edge.contract.description, slaHours: edge.contract.slaHours ?? null },
        created_by_blueprint_id: blueprint.id,
        created_by_plan_id: planId,
      });
      if (error) throw error;
      return { edgeRowId: step.payload.edgeRowId };
    }

    case "create_outcome_task": {
      const outcome = payload.outcomes.find((o) => o.id === step.payload.outcomeId);
      if (!outcome) throw new Error(`Unknown outcome ${step.payload.outcomeId}`);
      const ownerSeat = payload.seats.find((s) => s.id === outcome.ownerSeatId);
      const roomId = ownerSeat?.primaryRoomId ?? payload.rooms[0]?.id;
      if (!roomId) throw new Error("No room available to attach outcome task to.");
      const { error } = await client.from("tasks").upsert(
        {
          workspace_id: workspaceId,
          id: step.payload.taskId,
          room_id: roomId,
          title: `Track outcome: ${outcome.title}`,
          description: `${outcome.metric} — target: ${outcome.target}. Checkpoint cadence: ${outcome.checkpointCadence}.`,
          status: "open",
          priority: "medium",
          assignee_type: ownerSeat ? "ai" : "human",
          assignee_id: ownerSeat?.id ?? "unassigned",
          created_from: "workforce_studio",
          created_by_blueprint_id: blueprint.id,
          created_by_blueprint_revision: blueprint.approvedRevision,
          created_by_plan_id: planId,
        },
        { onConflict: "workspace_id,id" },
      );
      if (error) throw error;
      return { taskId: step.payload.taskId };
    }

    case "first_mission_task": {
      const roomId =
        payload.seats.find((s) => s.id === step.payload.ownerSeatId)?.primaryRoomId ?? payload.rooms[0]?.id;
      if (!roomId) throw new Error("No room available to attach first-mission task to.");
      const { error } = await client.from("tasks").upsert(
        {
          workspace_id: workspaceId,
          id: step.payload.taskId,
          room_id: roomId,
          title: String(step.payload.title),
          description: String(step.payload.description),
          status: "open",
          priority: "high",
          assignee_type: "ai",
          assignee_id: String(step.payload.ownerSeatId),
          due_date: step.payload.dueDate ?? null,
          created_from: "workforce_studio_first_mission",
          created_by_blueprint_id: blueprint.id,
          created_by_blueprint_revision: blueprint.approvedRevision,
          created_by_plan_id: planId,
        },
        { onConflict: "workspace_id,id" },
      );
      if (error) throw error;
      return { taskId: step.payload.taskId };
    }

    case "first_mission_message": {
      const seat = payload.seats.find((s) => s.id === step.payload.seatId);
      if (!seat || !seat.primaryRoomId) return { skipped: true };
      const content = `👋 I'm ${seat.roleTitle}, just joined this team. My mission: ${seat.mission}`;
      const { error } = await client.from("messages").upsert(
        {
          workspace_id: workspaceId,
          id: step.payload.messageId,
          room_id: seat.primaryRoomId,
          sender_type: "ai",
          sender_id: seat.id,
          sender_name: seat.roleTitle,
          content,
        },
        { onConflict: "workspace_id,id" },
      );
      if (error) throw error;
      return { messageId: step.payload.messageId };
    }

    case "create_artifact": {
      if (step.payload.artifactKind === "team_charter") {
        const markdown = buildTeamCharterMarkdown(blueprint.name, payload);
        const leadershipRoom = payload.rooms.find((r) => r.kind === "leadership") ?? payload.rooms[0];
        const { error } = await client.from("artifacts").upsert(
          {
            id: step.payload.artifactId,
            workspace_id: workspaceId,
            room_id: leadershipRoom?.id ?? null,
            title: `${blueprint.name} — Team Charter`,
            artifact_type: "team_charter",
            status: "saved",
            content_markdown: markdown,
            created_by_type: "ai",
            created_by_id: MAYA_EMPLOYEE_ID,
            created_by_blueprint_id: blueprint.id,
            created_by_blueprint_revision: blueprint.approvedRevision,
            created_by_plan_id: planId,
          },
          { onConflict: "id" },
        );
        if (error) throw error;
        return { artifactId: step.payload.artifactId };
      }

      const seat = payload.seats.find((s) => s.id === step.payload.seatId);
      if (!seat) throw new Error(`Unknown seat ${step.payload.seatId}`);
      const markdown = buildRoleScorecardMarkdown(seat);
      const { error } = await client.from("artifacts").upsert(
        {
          id: step.payload.artifactId,
          workspace_id: workspaceId,
          room_id: seat.primaryRoomId ?? null,
          title: `${seat.roleTitle} — Role Scorecard`,
          artifact_type: "role_scorecard",
          status: "saved",
          content_markdown: markdown,
          created_by_type: "ai",
          created_by_id: MAYA_EMPLOYEE_ID,
          created_by_blueprint_id: blueprint.id,
          created_by_blueprint_revision: blueprint.approvedRevision,
          created_by_plan_id: planId,
        },
        { onConflict: "id" },
      );
      if (error) throw error;
      return { artifactId: step.payload.artifactId };
    }

    default:
      throw new Error(`Unknown step type ${step.stepType}`);
  }
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

export async function compensateStep(
  client: SupabaseClient,
  workspaceId: string,
  step: { stepType: StepInput["stepType"]; payload: Record<string, unknown> },
): Promise<void> {
  switch (step.stepType) {
    case "create_room":
      await client.from("rooms").delete().eq("workspace_id", workspaceId).eq("id", step.payload.roomId);
      return;
    case "create_employee":
      await client.from("ai_employees").delete().eq("workspace_id", workspaceId).eq("id", step.payload.seatId);
      return;
    case "grant_tools":
      await client
        .from("employee_tools")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("employee_id", step.payload.seatId);
      return;
    case "add_room_member":
      await client
        .from("room_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("room_id", step.payload.roomId)
        .eq("member_type", "ai")
        .eq("member_id", step.payload.seatId);
      return;
    case "create_collaboration_edge":
      await client.from("work_graph_edges").delete().eq("workspace_id", workspaceId).eq("id", step.payload.edgeRowId);
      return;
    case "create_outcome_task":
    case "first_mission_task":
      await client.from("tasks").delete().eq("workspace_id", workspaceId).eq("id", step.payload.taskId);
      return;
    case "first_mission_message":
      await client.from("messages").delete().eq("workspace_id", workspaceId).eq("id", step.payload.messageId);
      return;
    case "create_artifact":
      await client.from("artifacts").delete().eq("workspace_id", workspaceId).eq("id", step.payload.artifactId);
      return;
    default:
      return;
  }
}
