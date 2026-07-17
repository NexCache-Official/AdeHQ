import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIntelligencePolicyForHire } from "@/lib/ai/intelligence-policy";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import {
  MAYA_EMPLOYEE_ID,
  MAYA_SYSTEM_EMPLOYEE_KEY,
} from "@/lib/hiring/maya";
import { buildMayaEmployee, isMayaEmployee } from "@/lib/maya-employee";
import { AuthError } from "@/lib/supabase/auth-server";
import { ensurePrivateAiDm } from "@/lib/server/ensure-private-dm";
import { getWorkspaceMemberRole } from "@/lib/server/room-access";
import { canAccessMaya } from "@/lib/workspace/access";
import type { AIEmployee, ProjectRoom } from "@/lib/types";
import { nowISO } from "@/lib/utils";

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
    employee_kind: "system_manager",
    employee_access: "restricted",
    metadata: maya.metadata ?? {},
    intelligence_policy: buildIntelligencePolicyForHire({
      modelMode: maya.modelMode ?? "balanced",
      roleKey: maya.roleKey,
      browserAccess: "research_only",
    }),
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
        employee_kind: "system_manager",
        employee_access: "restricted",
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

/**
 * Per-admin private Maya DM. Members are rejected.
 */
export async function ensureMayaDM(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  _firstName?: string,
): Promise<ProjectRoom> {
  const role = await getWorkspaceMemberRole(client, workspaceId, userId);
  if (!role || !canAccessMaya(role)) {
    throw new AuthError("Only workspace admins can open a Maya DM.", 403);
  }

  await ensureMayaForWorkspace(client, workspaceId);
  const maya = buildMayaEmployee();
  const row = await ensurePrivateAiDm(client, {
    workspaceId,
    userId,
    role,
    employeeId: MAYA_EMPLOYEE_ID,
    employeeName: maya.name,
    accent: maya.accent,
    brief: maya.instructions,
  });

  return {
    id: String(row.id),
    name: String(row.name),
    kind: "dm",
    dmEmployeeId: MAYA_EMPLOYEE_ID,
    dmOwnerUserId: userId,
    description: String(row.description ?? ""),
    brief: String(row.brief ?? ""),
    humans: [userId],
    aiEmployees: [MAYA_EMPLOYEE_ID],
    messages: [],
    tasks: [],
    memory: [],
    unread: Number(row.unread ?? 0),
    accent: String(row.accent ?? maya.accent),
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? nowISO()),
  };
}

export async function ensureMayaWorkspaceBundle(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
  firstName?: string,
): Promise<{ employee: AIEmployee; dmRoom: ProjectRoom }> {
  const employee = await ensureMayaForWorkspace(client, workspaceId);
  const role = await getWorkspaceMemberRole(client, workspaceId, userId);
  if (!role || !canAccessMaya(role)) {
    // Members still get Maya employee row in workspace, but no DM
    return {
      employee,
      dmRoom: {
        id: "",
        name: employee.name,
        kind: "dm",
        dmEmployeeId: MAYA_EMPLOYEE_ID,
        description: "",
        brief: "",
        humans: [],
        aiEmployees: [MAYA_EMPLOYEE_ID],
        messages: [],
        tasks: [],
        memory: [],
        unread: 0,
        accent: employee.accent,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      },
    };
  }
  const dmRoom = await ensureMayaDM(client, workspaceId, userId, firstName);
  return { employee, dmRoom };
}

export { isMayaEmployee };
