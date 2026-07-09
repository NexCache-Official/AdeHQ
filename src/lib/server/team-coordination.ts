// ===========================================================================
// Team coordination — lets an AI employee delegate to / coordinate with another
// employee the way a real coworker would: find a room you both belong to, bring
// it up there, and get them working on it with you.
//
// Rules of the workspace:
//  - AI ↔ AI conversation only happens in shared GROUP rooms, never in DMs.
//  - Coordinate in the room's general topic by default; branch to a relevant
//    existing topic when a hint matches.
//  - One coordination hop per originating instruction (loop guard) so employees
//    don't ping-pong across rooms forever.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee } from "@/lib/types";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { processQueuedAgentRun } from "@/lib/server/process-queued-run";
import { drainQueuedAgentRunsForRoot } from "@/lib/server/background-agent-drainer";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { nowISO, uid } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export type SharedRoomResolution = {
  roomId: string;
  roomName: string;
  topicId: string;
  topicTitle: string;
};

/** Find a group room both employees belong to (most recently active first). */
export async function resolveSharedRoom(
  client: SupabaseClient,
  workspaceId: string,
  sourceEmployeeId: string,
  targetEmployeeId: string,
  opts: { topicHint?: string } = {},
): Promise<SharedRoomResolution | null> {
  const roomIdsFor = async (employeeId: string): Promise<Set<string>> => {
    const { data, error } = await client
      .from("room_members")
      .select("room_id")
      .eq("workspace_id", workspaceId)
      .eq("member_type", "ai")
      .eq("member_id", employeeId);
    if (error) throw error;
    return new Set(((data as DbRow[] | null) ?? []).map((r) => String(r.room_id)));
  };

  const [sourceRooms, targetRooms] = await Promise.all([
    roomIdsFor(sourceEmployeeId),
    roomIdsFor(targetEmployeeId),
  ]);
  const sharedIds = [...sourceRooms].filter((id) => targetRooms.has(id));
  if (!sharedIds.length) return null;

  // Only group rooms — AI never coordinates inside a DM.
  const { data: roomRows, error: roomError } = await client
    .from("rooms")
    .select("id, name, kind, status, updated_at")
    .eq("workspace_id", workspaceId)
    .in("id", sharedIds);
  if (roomError) throw roomError;

  const groupRooms = ((roomRows as DbRow[] | null) ?? [])
    .filter((r) => String(r.kind) !== "dm" && String(r.status ?? "active") !== "archived")
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  if (!groupRooms.length) return null;

  const room = groupRooms[0];
  const roomId = String(room.id);
  const roomName = String(room.name);

  // Prefer a relevant existing topic when a hint is given; else the general topic.
  if (opts.topicHint?.trim()) {
    const { data: topicRows } = await client
      .from("topics")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId)
      .neq("status", "archived")
      .ilike("title", `%${opts.topicHint.trim()}%`)
      .limit(1);
    const match = (topicRows as DbRow[] | null)?.[0];
    if (match) {
      return { roomId, roomName, topicId: String(match.id), topicTitle: String(match.title) };
    }
  }

  const general = await ensureGeneralTopic(client, workspaceId, roomId);
  return { roomId, roomName, topicId: general.id, topicTitle: general.title };
}

/** Read the coordination depth stamped on the current agent run (loop guard). */
async function coordinationDepth(
  client: SupabaseClient,
  workspaceId: string,
  agentRunId?: string,
): Promise<number> {
  if (!agentRunId) return 0;
  const { data } = await client
    .from("agent_runs")
    .select("run_metadata")
    .eq("workspace_id", workspaceId)
    .eq("id", agentRunId)
    .maybeSingle();
  const meta = (data?.run_metadata as Record<string, unknown> | null) ?? {};
  const depth = Number(meta.coordinationDepth ?? 0);
  return Number.isFinite(depth) ? depth : 0;
}

/** Minimal employee shape queueAgentRuns needs (id, name, provider, modelMode). */
async function loadEmployeeForQueue(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<AIEmployee | null> {
  const { data } = await client
    .from("ai_employees")
    .select("id, name, role, provider, model, model_mode")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    name: String(data.name),
    role: String(data.role ?? "AI employee"),
    provider: String(data.provider ?? "siliconflow"),
    model: String(data.model ?? ""),
    modelMode: (data.model_mode ? String(data.model_mode) : "balanced") as AIEmployee["modelMode"],
  } as unknown as AIEmployee;
}

export type CoordinateParams = {
  workspaceId: string;
  sourceEmployeeId: string;
  sourceEmployeeName: string;
  targetEmployeeId?: string;
  targetEmployeeName?: string;
  message: string;
  topicHint?: string;
  currentAgentRunId?: string;
};

export type CoordinateResult = {
  ok: boolean;
  reason?: string;
  roomId?: string;
  roomName?: string;
  topicId?: string;
  topicTitle?: string;
  targetEmployeeName?: string;
  targetResponded?: boolean;
  drainedFollowUpRuns?: number;
};

/**
 * Bring a colleague into a shared room and get them working on it. Posts the
 * source employee's message (mentioning the target) in the shared room/topic,
 * queues the target's run there, and drives it once so they actually respond.
 */
export async function coordinateWithColleague(
  client: SupabaseClient,
  params: CoordinateParams,
): Promise<CoordinateResult> {
  // Loop guard: a run that was itself spawned by coordination can't coordinate again.
  const depth = await coordinationDepth(client, params.workspaceId, params.currentAgentRunId);
  if (depth >= 1) {
    return { ok: false, reason: "Already in a coordination thread — keep the discussion in this room." };
  }

  // Resolve the target employee.
  let targetId = params.targetEmployeeId;
  let targetName = params.targetEmployeeName;
  if (!targetId && targetName) {
    const { data } = await client
      .from("ai_employees")
      .select("id, name")
      .eq("workspace_id", params.workspaceId)
      .ilike("name", `%${targetName.trim()}%`)
      .limit(1)
      .maybeSingle();
    if (data) { targetId = String(data.id); targetName = String(data.name); }
  }
  if (!targetId) {
    return { ok: false, reason: `Couldn't find a colleague named "${params.targetEmployeeName ?? ""}".` };
  }
  if (targetId === params.sourceEmployeeId) {
    return { ok: false, reason: "Can't coordinate with yourself." };
  }

  const shared = await resolveSharedRoom(client, params.workspaceId, params.sourceEmployeeId, targetId, {
    topicHint: params.topicHint,
  });
  if (!shared) {
    return {
      ok: false,
      targetEmployeeName: targetName,
      reason: `${targetName ?? "That teammate"} and I aren't in a shared room yet — add us both to a room and I'll bring it up there.`,
    };
  }

  const targetEmployee = await loadEmployeeForQueue(client, params.workspaceId, targetId);
  if (!targetEmployee) {
    return { ok: false, reason: "That colleague no longer exists." };
  }
  targetName = targetEmployee.name;

  // Post the coordination opener from the source employee, @mentioning the target.
  const messageId = uid("msg");
  const content = `@${targetName} ${params.message.trim()}`;
  const mentionsJson = [{ type: "ai_employee" as const, id: targetId, label: targetName }];
  const { error: insertError } = await client.from("messages").insert({
    workspace_id: params.workspaceId,
    id: messageId,
    room_id: shared.roomId,
    topic_id: shared.topicId,
    sender_type: "ai",
    sender_id: params.sourceEmployeeId,
    sender_name: params.sourceEmployeeName,
    content,
    mentions: [targetId],
    mentions_json: mentionsJson,
    pending: false,
    created_at: nowISO(),
  });
  if (insertError) {
    return { ok: false, reason: "Couldn't post the coordination message." };
  }

  // Queue the target's run in that room/topic and drive it once (stamped with
  // coordinationDepth so it can't spawn another cross-room hop).
  const aiClient = (() => {
    try { return createSupabaseSecretClient(); } catch { return client; }
  })();

  let targetResponded = false;
  let drainedFollowUpRuns = 0;
  try {
    const { queued } = await queueAgentRuns(aiClient, {
      workspaceId: params.workspaceId,
      roomId: shared.roomId,
      topicId: shared.topicId,
      triggerMessageId: messageId,
      responders: [
        {
          employee: targetEmployee,
          reason: "handoff",
          runMetadata: {
            coordinationDepth: 1,
            coordinationSourceEmployeeId: params.sourceEmployeeId,
            coordinationSourceEmployeeName: params.sourceEmployeeName,
          },
        },
      ],
      content,
    });
    const run = queued[0];
    if (run) {
      const result = await processQueuedAgentRun(aiClient, params.workspaceId, run.runId, {});
      targetResponded = Boolean(result?.aiMessageId);
      const drained = await drainQueuedAgentRunsForRoot(aiClient, {
        workspaceId: params.workspaceId,
        rootTriggerMessageId: messageId,
        maxRuns: 6,
      });
      drainedFollowUpRuns = drained.processedRunIds.length;
    }
  } catch (error) {
    console.warn("[AdeHQ coordination] target run failed", error);
  }

  return {
    ok: true,
    roomId: shared.roomId,
    roomName: shared.roomName,
    topicId: shared.topicId,
    topicTitle: shared.topicTitle,
    targetEmployeeName: targetName,
    targetResponded,
    drainedFollowUpRuns,
  };
}

/** List employees a colleague could coordinate with (excluding self, DM-only agents). */
export async function suggestColleagues(
  client: SupabaseClient,
  workspaceId: string,
  sourceEmployeeId: string,
): Promise<Array<{ id: string; name: string; role: string; sharedRoom: boolean }>> {
  const { data: employees } = await client
    .from("ai_employees")
    .select("id, name, role, metadata")
    .eq("workspace_id", workspaceId);

  const sourceRoomsRes = await client
    .from("room_members")
    .select("room_id")
    .eq("workspace_id", workspaceId)
    .eq("member_type", "ai")
    .eq("member_id", sourceEmployeeId);
  const sourceRooms = new Set(((sourceRoomsRes.data as DbRow[] | null) ?? []).map((r) => String(r.room_id)));

  const result: Array<{ id: string; name: string; role: string; sharedRoom: boolean }> = [];
  for (const emp of (employees as DbRow[] | null) ?? []) {
    const id = String(emp.id);
    if (id === sourceEmployeeId) continue;
    const meta = (emp.metadata as Record<string, unknown> | null) ?? {};
    if (meta.dmOnly === true) continue; // DM-only agents (e.g. Maya) aren't coordination targets
    const roomsRes = await client
      .from("room_members")
      .select("room_id")
      .eq("workspace_id", workspaceId)
      .eq("member_type", "ai")
      .eq("member_id", id);
    const shared = ((roomsRes.data as DbRow[] | null) ?? []).some((r) => sourceRooms.has(String(r.room_id)));
    result.push({ id, name: String(emp.name), role: String(emp.role ?? ""), sharedRoom: shared });
  }
  return result;
}
