import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee } from "@/lib/types";
import { isMayaEmployee } from "@/lib/maya-employee";
import { buildContextForThread } from "@/lib/inbox/work-actions";
import { formatEmailWorkBridgeMessage, truncateText } from "@/lib/inbox/work-context";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { listActiveEdgesForThread } from "@/lib/inbox/work-graph";
import { findWorkAction, completeWorkAction } from "@/lib/inbox/work-idempotency";
import { updateEmailMission } from "@/lib/inbox/mission-status";
import { insertSystemMessage } from "@/lib/server/room-messages";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { nowISO } from "@/lib/utils";

type WakeResult = {
  roomId: string;
  topicId: string;
  messageId: string;
  employeeId: string;
  queuedRuns: string[];
  originRoomNotified: boolean;
};

function employeeFromRow(row: Record<string, unknown>): AIEmployee {
  return {
    id: String(row.id),
    name: String(row.name ?? "Employee"),
    role: String(row.role ?? ""),
    roleKey: (row.role_key as AIEmployee["roleKey"]) ?? "operations",
    provider: String(row.provider ?? "siliconflow"),
    model: String(row.model ?? ""),
    modelMode: (row.model_mode as AIEmployee["modelMode"]) ?? "balanced",
    seniority: String(row.seniority ?? ""),
    status: (row.status as AIEmployee["status"]) ?? "online",
    instructions: String(row.instructions ?? ""),
    communicationStyle: String(row.communication_style ?? ""),
    successCriteria: String(row.success_criteria ?? ""),
    tools: [],
    permissions: {} as AIEmployee["permissions"],
    memoryCount: 0,
    tasksCompleted: 0,
    messagesSent: 0,
    approvalsRequested: 0,
    avgResponseTime: "-",
    trustScore: 75,
    accent: String(row.accent ?? "#2f6fed"),
    lastActiveAt: nowISO(),
    createdAt: nowISO(),
    isSystemEmployee: Boolean(row.is_system_employee),
    systemEmployeeKey: row.system_employee_key ? String(row.system_employee_key) : null,
  };
}

async function resolveHumanOwner(
  client: SupabaseClient,
  params: { workspaceId: string; assignedHumanId?: string | null },
): Promise<{ id: string; name: string } | null> {
  let userId = params.assignedHumanId ?? null;
  if (!userId) {
    const { data: admin } = await client
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", params.workspaceId)
      .eq("status", "active")
      .eq("role", "admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    userId = admin?.user_id ? String(admin.user_id) : null;
  }
  if (!userId) {
    const { data: member } = await client
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", params.workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    userId = member?.user_id ? String(member.user_id) : null;
  }
  if (!userId) return null;
  const { data: profile } = await client
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  return { id: userId, name: String(profile?.name ?? "Teammate") };
}

async function ensureEmployeeDm(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employee: AIEmployee;
    humanUserId: string;
  },
): Promise<{ roomId: string; topicId: string }> {
  const { data: existing } = await client
    .from("rooms")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("kind", "dm")
    .eq("dm_employee_id", params.employee.id)
    .maybeSingle();
  const roomId = existing?.id ? String(existing.id) : `dm-${params.employee.id}`;
  const now = nowISO();
  if (!existing) {
    const { error } = await client.from("rooms").insert({
      workspace_id: params.workspaceId,
      id: roomId,
      name: params.employee.name,
      kind: "dm",
      dm_employee_id: params.employee.id,
      dm_owner_user_id: params.humanUserId,
      dm_peer_user_id: null,
      dm_pair_key: null,
      room_visibility: null,
      description: "",
      brief: "",
      unread: 0,
      accent: params.employee.accent || "#2f6fed",
      status: "active",
      created_at: now,
      updated_at: now,
    });
    if (error && error.code !== "23505") throw error;
  }
  const { error: memberError } = await client.from("room_members").upsert(
    [
      {
        workspace_id: params.workspaceId,
        room_id: roomId,
        member_type: "human",
        member_id: params.humanUserId,
        created_at: now,
      },
      {
        workspace_id: params.workspaceId,
        room_id: roomId,
        member_type: "ai",
        member_id: params.employee.id,
        created_at: now,
      },
    ],
    { onConflict: "workspace_id,room_id,member_type,member_id" },
  );
  if (memberError) throw memberError;
  const topic = await ensureGeneralTopic(client, params.workspaceId, roomId);
  return { roomId, topicId: topic.id };
}

async function resolveOriginRoom(
  client: SupabaseClient,
  params: { workspaceId: string; threadId: string },
): Promise<{ roomId: string; topicId?: string } | null> {
  const edges = await listActiveEdgesForThread(client, params);
  for (const edge of edges) {
    const roomId =
      edge.toObjectType === "room"
        ? edge.toObjectId
        : typeof edge.metadata.roomId === "string"
          ? edge.metadata.roomId
          : null;
    if (!roomId) continue;
    const { data: room } = await client
      .from("rooms")
      .select("id, kind, status")
      .eq("workspace_id", params.workspaceId)
      .eq("id", roomId)
      .maybeSingle();
    if (!room || room.kind === "dm" || room.status === "archived") continue;
    return {
      roomId,
      topicId: typeof edge.metadata.topicId === "string" ? edge.metadata.topicId : undefined,
    };
  }
  return null;
}

/**
 * Idempotently wake the assigned employee after inbound triage.
 * The steward shares only the privacy-safe bridge and never drafts/sends automatically.
 */
export async function wakeEmployeeForEmailThread(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    threadId: string;
    messageId: string;
    employeeId: string;
  },
): Promise<WakeResult | null> {
  const clientActionId = `email-wake:${params.threadId}:${params.messageId}`;
  const prior = await findWorkAction(client, {
    workspaceId: params.workspaceId,
    clientActionId,
  });
  if (prior?.status === "completed") return prior.resultPayload as WakeResult;

  const [{ data: thread }, { data: employeeRow }] = await Promise.all([
    client
      .from("email_threads")
      .select("assigned_human_id, reply_required, steward_meta, subject")
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.threadId)
      .maybeSingle(),
    client
      .from("ai_employees")
      .select("*")
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.employeeId)
      .maybeSingle(),
  ]);
  if (!thread || !employeeRow || !thread.reply_required) return null;
  const employee = employeeFromRow(employeeRow as Record<string, unknown>);
  if (isMayaEmployee(employee) || employee.status === "blocked") return null;

  const human = await resolveHumanOwner(client, {
    workspaceId: params.workspaceId,
    assignedHumanId: thread.assigned_human_id
      ? String(thread.assigned_human_id)
      : null,
  });
  if (!human) return null;

  const ctx = await buildContextForThread({
    client,
    workspaceId: params.workspaceId,
    mailboxId: params.mailboxId,
    threadId: params.threadId,
    userId: human.id,
  });
  const dm = await ensureEmployeeDm(client, {
    workspaceId: params.workspaceId,
    employee,
    humanUserId: human.id,
  });
  const stewardMeta = (thread.steward_meta as Record<string, unknown>) ?? {};
  const complexity = Array.isArray(stewardMeta.safetyFlags)
    ? (stewardMeta.safetyFlags as string[]).length > 0
    : false;
  // Keep chat user-facing; AI conduct for email_inbound_wake lives in process-queued-run.
  const content = [
    formatEmailWorkBridgeMessage(ctx),
    "",
    `@${employee.name} — a new inbound reply arrived on a thread you own.`,
    complexity
      ? `This one may need another perspective — ${employee.name} will check in before looping anyone else in.`
      : `${employee.name} will summarize what changed and ask how you want to reply.`,
  ].join("\n");
  const message = await insertSystemMessage(
    client,
    params.workspaceId,
    dm.roomId,
    content,
    dm.topicId,
    `email-wake-${params.messageId}`,
  );

  const { queued } = await queueAgentRuns(client, {
    workspaceId: params.workspaceId,
    roomId: dm.roomId,
    topicId: dm.topicId,
    triggerMessageId: message.id,
    responders: [
      {
        employee,
        reason: "explicit_mention",
        runMetadata: {
          workType: "email_inbound_wake",
          emailThreadId: params.threadId,
          emailMessageId: params.messageId,
          emailWakeMode: "ask_how_to_reply",
          inboxDeepLink: ctx.inboxDeepLink,
        },
      },
    ],
    content,
    skipAdmission: true,
    createdByType: "steward",
    createdById: "email-steward",
  });

  let originRoomNotified = false;
  const origin = await resolveOriginRoom(client, {
    workspaceId: params.workspaceId,
    threadId: params.threadId,
  });
  if (origin) {
    const topicId =
      origin.topicId ??
      (await ensureGeneralTopic(client, params.workspaceId, origin.roomId)).id;
    await insertSystemMessage(
      client,
      params.workspaceId,
      origin.roomId,
      `${employee.name} is reviewing a new reply on **${truncateText(ctx.subject, 90)}** and has asked ${human.name} for direction. ${ctx.inboxDeepLink}`,
      topicId,
      `email-room-headsup-${params.messageId}`,
    );
    originRoomNotified = true;
  }

  const result: WakeResult = {
    roomId: dm.roomId,
    topicId: dm.topicId,
    messageId: message.id,
    employeeId: employee.id,
    queuedRuns: queued.map((run) => run.runId),
    originRoomNotified,
  };
  await completeWorkAction(client, {
    workspaceId: params.workspaceId,
    mailboxId: params.mailboxId,
    threadId: params.threadId,
    clientActionId,
    actionType: "inbound_wake",
    actorUserId: human.id,
    resultPayload: result,
  });
  await updateEmailMission(client, {
    workspaceId: params.workspaceId,
    threadId: params.threadId,
    status: "awaiting_human",
    ownerEmployeeId: employee.id,
    lastWakeAt: nowISO(),
    originRoomId: origin?.roomId ?? null,
    originTopicId: origin?.topicId ?? null,
  });
  await recordEmailEvent(client, {
    workspaceId: params.workspaceId,
    mailboxId: params.mailboxId,
    threadId: params.threadId,
    messageId: params.messageId,
    actorType: "system",
    eventType: "email.employee_woken",
    payload: {
      employeeId: employee.id,
      dmRoomId: dm.roomId,
      dmTopicId: dm.topicId,
      queuedRunIds: result.queuedRuns,
      originRoomNotified,
    },
  });
  return result;
}
