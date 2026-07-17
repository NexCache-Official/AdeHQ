import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";
import { MAYA_EMPLOYEE_ID, MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import {
  buildAiDmInsert,
  buildHumanDmInsert,
  canAccessMaya,
  canDmAiEmployee,
  humanDmPairKey,
  type AiEmployeeAccessInput,
  type AiEmployeeUserGrant,
} from "@/lib/workspace/access";
import { normalizeWorkspaceRole } from "@/lib/workspace/permissions";
import { nowISO, uid } from "@/lib/utils";

type DbRoom = Record<string, unknown>;

function mapGrant(row: Record<string, unknown> | null): AiEmployeeUserGrant | null {
  if (!row) return null;
  return {
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    employeeId: String(row.employee_id),
    accessEffect: row.access_effect === "deny" ? "deny" : "allow",
    canDm: row.can_dm !== false,
    canAssignWork: row.can_assign_work !== false,
    canViewSharedOutputs: row.can_view_shared_outputs !== false,
  };
}

export async function loadAiEmployeeAccess(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<AiEmployeeAccessInput | null> {
  const { data, error } = await client
    .from("ai_employees")
    .select("id, employee_kind, employee_access, is_system_employee, system_employee_key")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const isSystem =
    Boolean(data.is_system_employee) ||
    data.system_employee_key === "maya" ||
    data.employee_kind === "system_manager";
  return {
    id: String(data.id),
    employeeKind: isSystem ? "system_manager" : "workspace_employee",
    employeeAccess:
      data.employee_access === "restricted" || data.employee_access === "department"
        ? data.employee_access
        : "workspace",
    isSystemManager: isSystem,
  };
}

export async function loadAiGrant(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  employeeId: string,
): Promise<AiEmployeeUserGrant | null> {
  const { data, error } = await client
    .from("ai_employee_user_grants")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return mapGrant(data as Record<string, unknown> | null);
}

async function upsertDmProjectionMembers(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  humanIds: string[],
  aiEmployeeId?: string | null,
) {
  const rows = [
    ...humanIds.map((id) => ({
      workspace_id: workspaceId,
      room_id: roomId,
      member_type: "human" as const,
      member_id: id,
    })),
    ...(aiEmployeeId
      ? [
          {
            workspace_id: workspaceId,
            room_id: roomId,
            member_type: "ai" as const,
            member_id: aiEmployeeId,
          },
        ]
      : []),
  ];
  const { error } = await client
    .from("room_members")
    .upsert(rows, { onConflict: "workspace_id,room_id,member_type,member_id" });
  if (error) throw error;
}

/** Open or create a private AI DM for the current human. Conflict-safe. */
export async function ensurePrivateAiDm(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    role: string;
    employeeId: string;
    employeeName?: string;
    accent?: string;
    brief?: string;
  },
): Promise<DbRoom> {
  const employee = await loadAiEmployeeAccess(client, params.workspaceId, params.employeeId);
  if (!employee) throw new AuthError("AI employee not found.", 404);

  if (employee.employeeKind === "system_manager" && !canAccessMaya(params.role)) {
    throw new AuthError("Only workspace admins can message the workforce manager.", 403);
  }

  const grant = await loadAiGrant(client, params.workspaceId, params.userId, params.employeeId);
  const allowed = canDmAiEmployee({
    actor: { userId: params.userId, role: normalizeWorkspaceRole(params.role) },
    employee,
    grant,
  });
  if (!allowed) {
    throw new AuthError("You do not have access to this AI employee.", 403);
  }

  const { data: existing, error: lookupError } = await client
    .from("rooms")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("kind", "dm")
    .eq("dm_owner_user_id", params.userId)
    .eq("dm_employee_id", params.employeeId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    await upsertDmProjectionMembers(
      client,
      params.workspaceId,
      String(existing.id),
      [params.userId],
      params.employeeId,
    );
    await ensureGeneralTopic(client, params.workspaceId, String(existing.id));
    return existing as DbRoom;
  }

  const now = nowISO();
  const insert = buildAiDmInsert({
    workspaceId: params.workspaceId,
    ownerUserId: params.userId,
    employeeId: params.employeeId,
    name: params.employeeName ?? (params.employeeId === MAYA_EMPLOYEE_ID ? MAYA_EMPLOYEE_NAME : "Direct message"),
    accent: params.accent,
    brief: params.brief,
    now,
  });

  const { data: created, error: insertError } = await client
    .from("rooms")
    .insert(insert)
    .select("*")
    .single();

  if (insertError) {
    // Race: another request won the unique index
    if (insertError.code === "23505") {
      const { data: raced, error: raceError } = await client
        .from("rooms")
        .select("*")
        .eq("workspace_id", params.workspaceId)
        .eq("kind", "dm")
        .eq("dm_owner_user_id", params.userId)
        .eq("dm_employee_id", params.employeeId)
        .maybeSingle();
      if (raceError) throw raceError;
      if (!raced) throw insertError;
      await upsertDmProjectionMembers(
        client,
        params.workspaceId,
        String(raced.id),
        [params.userId],
        params.employeeId,
      );
      return raced as DbRoom;
    }
    throw insertError;
  }

  await upsertDmProjectionMembers(
    client,
    params.workspaceId,
    String(created.id),
    [params.userId],
    params.employeeId,
  );
  await ensureGeneralTopic(client, params.workspaceId, String(created.id));

  // Seed welcome for Maya only once
  if (params.employeeId === MAYA_EMPLOYEE_ID) {
    const general = await ensureGeneralTopic(client, params.workspaceId, String(created.id));
    await client.from("messages").insert({
      workspace_id: params.workspaceId,
      id: uid("msg"),
      room_id: created.id,
      topic_id: general.id,
      sender_type: "ai",
      sender_id: MAYA_EMPLOYEE_ID,
      sender_name: MAYA_EMPLOYEE_NAME,
      content: "Hi — I'm Maya, your AI Workforce Manager. Ask me about hiring or how AdeHQ works.",
      created_at: now,
    });
  }

  return created as DbRoom;
}

export async function ensurePrivateHumanDm(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    peerUserId: string;
    peerName?: string;
  },
): Promise<DbRoom> {
  if (params.userId === params.peerUserId) {
    throw new AuthError("Cannot open a DM with yourself.", 400);
  }

  const pairKey = humanDmPairKey(params.userId, params.peerUserId);
  const { data: existing, error: lookupError } = await client
    .from("rooms")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("kind", "dm")
    .eq("dm_pair_key", pairKey)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    await upsertDmProjectionMembers(client, params.workspaceId, String(existing.id), [
      params.userId,
      params.peerUserId,
    ]);
    await ensureGeneralTopic(client, params.workspaceId, String(existing.id));
    return existing as DbRoom;
  }

  const now = nowISO();
  const insert = buildHumanDmInsert({
    workspaceId: params.workspaceId,
    userA: params.userId,
    userB: params.peerUserId,
    name: params.peerName ?? "Direct message",
    now,
  });

  const { data: created, error: insertError } = await client
    .from("rooms")
    .insert(insert)
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced, error: raceError } = await client
        .from("rooms")
        .select("*")
        .eq("workspace_id", params.workspaceId)
        .eq("dm_pair_key", pairKey)
        .maybeSingle();
      if (raceError) throw raceError;
      if (!raced) throw insertError;
      await upsertDmProjectionMembers(client, params.workspaceId, String(raced.id), [
        params.userId,
        params.peerUserId,
      ]);
      return raced as DbRoom;
    }
    throw insertError;
  }

  await upsertDmProjectionMembers(client, params.workspaceId, String(created.id), [
    params.userId,
    params.peerUserId,
  ]);
  await ensureGeneralTopic(client, params.workspaceId, String(created.id));
  return created as DbRoom;
}
