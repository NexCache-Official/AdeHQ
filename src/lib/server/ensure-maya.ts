import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import {
  MAYA_EMPLOYEE_ID,
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_TITLE,
  MAYA_SYSTEM_EMPLOYEE_KEY,
  mayaWelcomeMessage,
} from "@/lib/hiring/maya";
import {
  buildMayaDmRoom,
  buildMayaEmployee,
  isMayaEmployee,
} from "@/lib/maya-employee";
import { ensureGeneralTopic, backfillOrphanMessagesToGeneralTopic } from "@/lib/server/topic-helpers";
import type { AIEmployee, ProjectRoom } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";

type DbRow = Record<string, unknown>;

function mayaEmployeeRow(workspaceId: string, timestamp: string): DbRow {
  const maya = buildMayaEmployee(timestamp);
  return {
    workspace_id: workspaceId,
    id: maya.id,
    name: maya.name,
    role: maya.role,
    role_key: maya.roleKey,
    provider: maya.provider,
    model: maya.model || DEFAULT_SILICONFLOW_MODEL,
    model_mode: maya.modelMode ?? "balanced",
    seniority: maya.seniority,
    status: maya.status,
    current_task: null,
    instructions: maya.instructions,
    communication_style: maya.communicationStyle,
    success_criteria: maya.successCriteria,
    permissions: maya.permissions,
    memory_count: 0,
    tasks_completed: 0,
    messages_sent: 0,
    approvals_requested: 0,
    avg_response_time: "-",
    trust_score: maya.trustScore,
    accent: maya.accent,
    default_room_id: null,
    participation_style: maya.participationStyle ?? "proactive_operator",
    is_system_employee: true,
    system_employee_key: MAYA_SYSTEM_EMPLOYEE_KEY,
    metadata: maya.metadata ?? {},
    last_active_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export async function ensureMayaForWorkspace(
  client: SupabaseClient,
  workspaceId: string,
): Promise<AIEmployee> {
  const { data: existing, error: lookupError } = await client
    .from("ai_employees")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("system_employee_key", MAYA_SYSTEM_EMPLOYEE_KEY)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) {
    const maya = buildMayaEmployee(String(existing.updated_at ?? existing.created_at ?? nowISO()));
    await client
      .from("ai_employees")
      .update({
        status: "online",
        role: maya.role,
        instructions: maya.instructions,
        communication_style: maya.communicationStyle,
        success_criteria: maya.successCriteria,
        metadata: maya.metadata ?? {},
        updated_at: nowISO(),
      })
      .eq("workspace_id", workspaceId)
      .eq("system_employee_key", MAYA_SYSTEM_EMPLOYEE_KEY);
    return maya;
  }

  const timestamp = nowISO();
  const row = mayaEmployeeRow(workspaceId, timestamp);
  const { data: inserted, error: insertError } = await client
    .from("ai_employees")
    .upsert(row, { onConflict: "workspace_id,id" })
    .select("*")
    .single();

  if (insertError) throw insertError;
  return buildMayaEmployee(String(inserted.updated_at ?? inserted.created_at ?? timestamp));
}

export async function ensureMayaDM(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  firstName?: string,
): Promise<ProjectRoom> {
  await ensureMayaForWorkspace(client, workspaceId);

  const { data: existingRoom, error: roomLookupError } = await client
    .from("rooms")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("kind", "dm")
    .eq("dm_employee_id", MAYA_EMPLOYEE_ID)
    .maybeSingle();

  if (roomLookupError) throw roomLookupError;

  const welcome = mayaWelcomeMessage(firstName ?? "there");
  const timestamp = nowISO();

  if (existingRoom) {
    const roomId = String(existingRoom.id);
    await ensureGeneralTopic(client, workspaceId, roomId);
    await backfillOrphanMessagesToGeneralTopic(client, workspaceId, roomId);

    const { data: members, error: membersError } = await client
      .from("room_members")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId);
    if (membersError) throw membersError;

    const hasHuman = (members ?? []).some(
      (m: DbRow) => m.member_type === "human" && m.member_id === userId,
    );
    if (!hasHuman) {
      const { error: memberError } = await client.from("room_members").upsert(
        {
          workspace_id: workspaceId,
          room_id: roomId,
          member_type: "human",
          member_id: userId,
        },
        { onConflict: "workspace_id,channel_id,member_type,member_id" },
      );
      if (memberError) throw memberError;
    }

    const { data: messages, error: messagesError } = await client
      .from("messages")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId)
      .limit(1);
    if (messagesError) throw messagesError;

    if (!messages?.length) {
      const generalTopic = await ensureGeneralTopic(client, workspaceId, roomId);
      const welcomeMessage = {
        workspace_id: workspaceId,
        id: uid("msg"),
        room_id: roomId,
        topic_id: generalTopic.id,
        sender_type: "ai",
        sender_id: MAYA_EMPLOYEE_ID,
        sender_name: MAYA_EMPLOYEE_NAME,
        content: welcome,
        created_at: timestamp,
      };
      const { error: welcomeError } = await client.from("messages").insert(welcomeMessage);
      if (welcomeError) throw welcomeError;
    }

    return buildMayaDmRoom(userId, welcome);
  }

  const room = buildMayaDmRoom(userId, welcome);
  const { error: roomError } = await client.from("rooms").insert({
    workspace_id: workspaceId,
    id: room.id,
    name: room.name,
    kind: room.kind,
    dm_employee_id: room.dmEmployeeId,
    description: room.description,
    brief: room.brief,
    unread: 0,
    accent: room.accent,
    created_at: room.createdAt,
    updated_at: room.updatedAt,
  });
  if (roomError) throw roomError;

  const memberRows = [
    {
      workspace_id: workspaceId,
      room_id: room.id,
      member_type: "human",
      member_id: userId,
    },
    {
      workspace_id: workspaceId,
      room_id: room.id,
      member_type: "ai",
      member_id: MAYA_EMPLOYEE_ID,
    },
  ];
  const { error: membersError } = await client
    .from("room_members")
    .upsert(memberRows, { onConflict: "workspace_id,channel_id,member_type,member_id" });
  if (membersError) throw membersError;

  const generalTopic = await ensureGeneralTopic(client, workspaceId, room.id);

  if (room.messages[0]) {
    const msg = room.messages[0];
    const { error: messageError } = await client.from("messages").insert({
      workspace_id: workspaceId,
      id: msg.id,
      room_id: room.id,
      topic_id: generalTopic.id,
      sender_type: msg.senderType,
      sender_id: msg.senderId,
      sender_name: msg.senderName,
      content: msg.content,
      created_at: msg.createdAt,
    });
    if (messageError) throw messageError;
  }

  await backfillOrphanMessagesToGeneralTopic(client, workspaceId, room.id);

  return room;
}

export async function ensureMayaWorkspaceBundle(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  firstName?: string,
): Promise<{ employee: AIEmployee; dmRoom: ProjectRoom }> {
  const employee = await ensureMayaForWorkspace(client, workspaceId);
  const dmRoom = await ensureMayaDM(client, workspaceId, userId, firstName);
  return { employee, dmRoom };
}

export { isMayaEmployee };
