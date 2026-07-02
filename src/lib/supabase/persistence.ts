"use client";

import type { User } from "@supabase/supabase-js";
import { buildDemoState, TOOL_CATALOG } from "@/lib/demo";
import type {
  AIEmployee,
  Approval,
  Call,
  CallTranscriptLine,
  DemoState,
  EmployeePermissions,
  HumanUser,
  MemoryEntry,
  ProjectRoom,
  RoomMessage,
  RoomTopic,
  Task,
  TopicMember,
  Tool,
  ToolAccess,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceMemberRole,
  WorkLogEvent,
} from "@/lib/types";
import { normalizeLiveProvider } from "@/lib/config/features";
import { authHeaders } from "@/lib/api/auth-client";
import { isEmailConfirmed } from "@/lib/auth/session";
import { mayaWelcomeMessage, MAYA_EMPLOYEE_ID } from "@/lib/hiring/maya";
import { isMayaEmployee, mergeMayaIntoState, effectiveEmployeeStatus } from "@/lib/maya-employee";
import { isGeneralTopic } from "@/lib/topics";
import type { SystemEmployeeMetadata } from "@/lib/types";
import { normalizeHumanDelivery } from "@/lib/message-delivery";
import { topicFromRow, topicMemberFromRow } from "@/lib/server/topic-helpers";
import { nowISO } from "@/lib/utils";
import { supabase } from "./client";

type DbRow = Record<string, any>;

function roomIdFromRow(row: DbRow): string {
  return String(row.room_id ?? "");
}

const DEMO_HUMAN_ID = "user-shubham";

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function jsonObject<T extends object>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : fallback;
}

function fromUser(user: User, patch: Partial<HumanUser> = {}): HumanUser {
  const metadataName =
    typeof user.user_metadata?.name === "string" ? user.user_metadata.name : undefined;

  return {
    id: user.id,
    name: patch.name ?? metadataName ?? user.email?.split("@")[0] ?? "AdeHQ User",
    email: patch.email ?? user.email ?? "",
    avatar: patch.avatar,
    role: patch.role ?? "Founder",
  };
}

function profileFromRow(row: DbRow, user: User): HumanUser {
  return {
    id: row.id ?? user.id,
    name: row.name ?? fromUser(user).name,
    email: row.email ?? user.email ?? "",
    avatar: row.avatar ?? undefined,
    role: row.role ?? "Founder",
  };
}

function workspaceFromRow(row: DbRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug ?? undefined,
    plan: row.plan ?? "Founder",
    workspaceMode: row.workspace_mode === "demo" ? "demo" : "real",
    onboardingComplete: Boolean(row.onboarding_complete),
  };
}

function replaceDemoHumanId(id: string, userId: string) {
  return id === DEMO_HUMAN_ID ? userId : id;
}

/** @deprecated Demo seeding for Supabase — use loginDemo() instead. Never call during real signup. */
export function buildWorkspaceStateFromDemo(
  user: HumanUser,
  workspace: Workspace,
  onboardingComplete: boolean,
): DemoState {
  const demo = buildDemoState();

  return {
    ...demo,
    user,
    workspace,
    workspaceMembers: [
      {
        workspaceId: workspace.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: "owner",
        createdAt: nowISO(),
      },
    ],
    workspaceInvitations: [],
    onboardingComplete,
    rooms: demo.rooms.map((room) => ({
      ...room,
      humans: room.humans.map((id) => replaceDemoHumanId(id, user.id)),
      messages: room.messages.map((message) =>
        message.senderType === "human"
          ? { ...message, senderId: user.id, senderName: user.name }
          : message,
      ),
    })),
    tasks: demo.tasks.map((task) =>
      task.assigneeType === "human"
        ? { ...task, assigneeId: replaceDemoHumanId(task.assigneeId, user.id) }
        : task,
    ),
    memory: demo.memory.map((entry) =>
      entry.createdByType === "human"
        ? { ...entry, createdById: replaceDemoHumanId(entry.createdById, user.id) }
        : entry,
    ),
    calls: demo.calls.map((call) => ({
      ...call,
      participants: call.participants.map((participant) =>
        participant.type === "human"
          ? { ...participant, id: user.id, name: user.name }
          : participant,
      ),
      transcript: call.transcript.map((line) =>
        line.speakerId === DEMO_HUMAN_ID
          ? { ...line, speakerId: user.id, speakerName: user.name }
          : line,
      ),
    })),
    settings: { mode: "live", activeProvider: "siliconflow" },
  };
}

export function buildFreshWorkspaceState(
  user: HumanUser,
  workspace: Workspace,
  onboardingComplete: boolean,
  workspaceMembers: WorkspaceMember[] = [
    {
      workspaceId: workspace.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: "owner",
      createdAt: nowISO(),
    },
  ],
  workspaceInvitations: WorkspaceInvitation[] = [],
): DemoState {
  return {
    version: buildDemoState().version,
    user,
    workspace,
    workspaceMembers,
    workspaceInvitations,
    onboardingComplete,
    employees: [],
    rooms: [],
    topics: [],
    topicMembers: [],
    tasks: [],
    memory: [],
    approvals: [],
    workLog: [],
    tools: TOOL_CATALOG.map((tool) => ({ ...tool })),
    calls: [],
    settings: { mode: "live", activeProvider: "siliconflow" },
  };
}

export async function ensureProfile(
  user: User,
  patch: Partial<HumanUser> = {},
): Promise<HumanUser> {
  const profile = fromUser(user, patch);
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        avatar: profile.avatar ?? null,
        role: profile.role,
        updated_at: nowISO(),
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return profileFromRow(data, user);
}

async function ensureToolCatalogRemote(): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch("/api/tools/ensure-catalog", { method: "POST", headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Could not initialize tool catalog.");
  }
}

let bootstrapInFlight: Promise<{
  workspaceId: string;
  workspaceName: string;
  created: boolean;
}> | null = null;

/** Idempotent workspace create — safe to call from onboarding (server dedupes). */
export async function bootstrapWorkspaceRemote(
  workspaceName?: string,
): Promise<{ workspaceId: string; workspaceName: string; created: boolean }> {
  if (bootstrapInFlight) {
    const existing = await bootstrapInFlight;
    return { ...existing, created: false };
  }

  bootstrapInFlight = (async () => {
    const headers = await authHeaders();
    const res = await fetch("/api/workspaces/bootstrap", {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceName }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error ?? "Could not create workspace.");
    }
    return {
      workspaceId: String(payload.workspaceId),
      workspaceName: String(payload.workspaceName),
      created: Boolean(payload.created),
    };
  })();

  try {
    return await bootstrapInFlight;
  } finally {
    bootstrapInFlight = null;
  }
}

export function buildPendingSignupState(user: User, profile: HumanUser): DemoState {
  const workspaceName =
    typeof user.user_metadata?.workspace_name === "string" &&
    user.user_metadata.workspace_name.trim()
      ? user.user_metadata.workspace_name.trim()
      : "My AI Workspace";

  const placeholder: Workspace = {
    id: "",
    name: workspaceName,
    plan: "Founder",
    workspaceMode: "real",
    onboardingComplete: false,
  };

  return buildFreshWorkspaceState(profile, placeholder, false, [
    {
      workspaceId: "",
      userId: profile.id,
      name: profile.name,
      email: profile.email,
      role: "owner",
      createdAt: nowISO(),
    },
  ]);
}

export async function createWorkspaceForUser(
  user: User,
  workspaceName: string,
  profilePatch: Partial<HumanUser> = {},
): Promise<DemoState> {
  const profile = await ensureProfile(user, profilePatch);
  const bootstrapped = await bootstrapWorkspaceRemote(workspaceName);
  return loadWorkspaceState(user, bootstrapped.workspaceId);
}

async function fetchWorkspaceIdForUser(
  userId: string,
  preferredWorkspaceId?: string,
): Promise<string | null> {
  if (preferredWorkspaceId) {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("workspace_id", preferredWorkspaceId)
      .maybeSingle();

    if (error) throw error;
    if (data?.workspace_id) return data.workspace_id;
  }

  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0]?.workspace_id ?? null;
}

export type UserWorkspaceSummary = {
  id: string;
  name: string;
  role: WorkspaceMemberRole;
  workspaceMode: Workspace["workspaceMode"];
};

export async function listUserWorkspaces(userId: string): Promise<UserWorkspaceSummary[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces ( id, name, workspace_mode )")
    .eq("user_id", userId);

  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const joined = row.workspaces as
        | { id: string; name: string; workspace_mode: string }
        | { id: string; name: string; workspace_mode: string }[]
        | null;
      const ws = Array.isArray(joined) ? joined[0] : joined;
      if (!ws) return null;
      return {
        id: ws.id,
        name: ws.name,
        role: row.role as WorkspaceMemberRole,
        workspaceMode: ws.workspace_mode === "demo" ? "demo" : "real",
      } satisfies UserWorkspaceSummary;
    })
    .filter((row): row is UserWorkspaceSummary => row !== null);
}

export async function loadWorkspaceState(
  user: User,
  preferredWorkspaceId?: string,
): Promise<DemoState> {
  const profile = await ensureProfile(user);
  const workspaceId = await fetchWorkspaceIdForUser(user.id, preferredWorkspaceId);

  if (!workspaceId) {
    return buildPendingSignupState(user, profile);
  }

  const { data: workspaceRow, error: workspaceError } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", workspaceId)
    .single();

  if (workspaceError) throw workspaceError;

  const [
    toolsResult,
    workspaceToolsResult,
    employeesResult,
    employeeToolsResult,
    roomsResult,
    roomMembersResult,
    messagesResult,
    tasksResult,
    memoryResult,
    approvalsResult,
    workLogResult,
    callsResult,
    membersResult,
    invitationsResult,
    pendingInvitationsResult,
    topicsResult,
    topicMembersResult,
  ] = await Promise.all([
    supabase.from("tools").select("*"),
    supabase.from("workspace_tools").select("*").eq("workspace_id", workspaceId),
    supabase.from("ai_employees").select("*").eq("workspace_id", workspaceId),
    supabase.from("employee_tools").select("*").eq("workspace_id", workspaceId),
    supabase.from("rooms").select("*").eq("workspace_id", workspaceId),
    supabase.from("room_members").select("*").eq("workspace_id", workspaceId),
    supabase.from("messages").select("*").eq("workspace_id", workspaceId),
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId),
    supabase.from("memory_entries").select("*").eq("workspace_id", workspaceId),
    supabase.from("approvals").select("*").eq("workspace_id", workspaceId),
    supabase.from("work_log_events").select("*").eq("workspace_id", workspaceId),
    supabase.from("calls").select("*").eq("workspace_id", workspaceId),
    supabase.from("workspace_members").select("*").eq("workspace_id", workspaceId),
    supabase.from("workspace_invitations").select("*").eq("workspace_id", workspaceId),
    supabase
      .from("workspace_invitations")
      .select("*")
      .eq("status", "pending")
      .ilike("invited_email", user.email ?? ""),
    supabase.from("topics").select("*").eq("workspace_id", workspaceId),
    supabase.from("topic_members").select("*").eq("workspace_id", workspaceId),
  ]);

  const results = [
    toolsResult,
    workspaceToolsResult,
    employeesResult,
    employeeToolsResult,
    roomsResult,
    roomMembersResult,
    messagesResult,
    tasksResult,
    memoryResult,
    approvalsResult,
    workLogResult,
    callsResult,
    membersResult,
    invitationsResult,
    pendingInvitationsResult,
    topicsResult,
    topicMembersResult,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const toolCatalog = ((toolsResult.data as DbRow[] | null) ?? []).map(toolFromRow);
  const catalog = toolCatalog.length ? toolCatalog : TOOL_CATALOG.map((tool) => ({ ...tool }));
  const toolsById = new Map(catalog.map((tool) => [tool.id, tool]));

  const workspaceToolStatus = new Map(
    ((workspaceToolsResult.data as DbRow[] | null) ?? []).map((row) => [
      row.tool_id,
      row.status,
    ]),
  );

  const tools = catalog.map((tool) => ({
    ...tool,
    status: workspaceToolStatus.get(tool.id) ?? tool.status,
  }));

  const employeeToolsByEmployee = new Map<string, ToolAccess[]>();
  for (const row of (employeeToolsResult.data as DbRow[] | null) ?? []) {
    const meta = toolsById.get(row.tool_id);
    const access: ToolAccess = {
      toolId: row.tool_id,
      name: meta?.name ?? row.tool_id,
      category: meta?.category ?? "Productivity",
      status: row.status ?? "mock",
      permission: row.permission ?? "read",
      lastUsedAt: row.last_used_at ?? undefined,
    };
    const existing = employeeToolsByEmployee.get(row.employee_id) ?? [];
    existing.push(access);
    employeeToolsByEmployee.set(row.employee_id, existing);
  }

  const employees = ((employeesResult.data as DbRow[] | null) ?? [])
    .map((row) => employeeFromRow(row, employeeToolsByEmployee.get(row.id) ?? []))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const tasks = ((tasksResult.data as DbRow[] | null) ?? [])
    .map(taskFromRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const memory = ((memoryResult.data as DbRow[] | null) ?? [])
    .map(memoryFromRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const approvals = ((approvalsResult.data as DbRow[] | null) ?? [])
    .map(approvalFromRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const workLog = ((workLogResult.data as DbRow[] | null) ?? [])
    .map(workLogFromRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const messages = ((messagesResult.data as DbRow[] | null) ?? [])
    .map(messageFromRow)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const topics = ((topicsResult.data as DbRow[] | null) ?? [])
    .map(topicFromRow)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const topicMembers = ((topicMembersResult.data as DbRow[] | null) ?? []).map(topicMemberFromRow);

  const roomMembersByRoom = new Map<string, DbRow[]>();
  for (const member of (roomMembersResult.data as DbRow[] | null) ?? []) {
    const roomKey = roomIdFromRow(member);
    const existing = roomMembersByRoom.get(roomKey) ?? [];
    existing.push(member);
    roomMembersByRoom.set(roomKey, existing);
  }

  const messagesByRoom = groupBy(messages, (message) => message.roomId);
  const tasksByRoom = groupBy(tasks, (task) => task.roomId);
  const memoryByRoom = groupBy(memory, (entry) => entry.roomId);

  const rooms = ((roomsResult.data as DbRow[] | null) ?? [])
    .map((row) =>
      roomFromRow(
        row,
        roomMembersByRoom.get(row.id) ?? [],
        messagesByRoom.get(row.id) ?? [],
        tasksByRoom.get(row.id)?.map((task) => task.id) ?? [],
        memoryByRoom.get(row.id)?.map((entry) => entry.id) ?? [],
      ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const calls = ((callsResult.data as DbRow[] | null) ?? [])
    .map(callFromRow)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const workspace = workspaceFromRow(workspaceRow);
  const workspaceMembers = await hydrateWorkspaceMembers(
    (membersResult.data as DbRow[] | null) ?? [],
  );
  const workspaceInvitations = await hydrateWorkspaceInvitations([
    ...((invitationsResult.data as DbRow[] | null) ?? []),
    ...((pendingInvitationsResult.data as DbRow[] | null) ?? []),
  ]);

  let finalEmployees = employees;
  let finalRooms = rooms;
  let finalTopics = topics;
  let finalTopicMembers = topicMembers;

  const mayaDmRoom = rooms.find((room) => room.kind === "dm" && room.dmEmployeeId === MAYA_EMPLOYEE_ID);
  const needsMayaEnsure =
    !employees.some(isMayaEmployee) ||
    !rooms.some((room) => room.kind === "dm" && room.dmEmployeeId === MAYA_EMPLOYEE_ID) ||
    (Boolean(mayaDmRoom) &&
      !topics.some((topic) => topic.roomId === mayaDmRoom?.id && isGeneralTopic(topic)));

  if (needsMayaEnsure) {
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/workspaces/ensure-maya", { method: "POST", headers });
      if (res.ok) {
        const [empRefresh, roomRefresh, memberRefresh, msgRefresh, topicsRefresh, topicMembersRefresh] =
          await Promise.all([
          supabase.from("ai_employees").select("*").eq("workspace_id", workspaceId),
          supabase.from("rooms").select("*").eq("workspace_id", workspaceId).eq("kind", "dm"),
          supabase.from("room_members").select("*").eq("workspace_id", workspaceId),
          supabase.from("messages").select("*").eq("workspace_id", workspaceId),
          supabase.from("topics").select("*").eq("workspace_id", workspaceId),
          supabase.from("topic_members").select("*").eq("workspace_id", workspaceId),
        ]);
        if (!empRefresh.error && empRefresh.data) {
          finalEmployees = (empRefresh.data as DbRow[])
            .map((row) => employeeFromRow(row, employeeToolsByEmployee.get(row.id) ?? []))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        }
        if (!roomRefresh.error && roomRefresh.data) {
          const refreshedMembers = (memberRefresh.data as DbRow[] | null) ?? [];
          const refreshedMessages = ((msgRefresh.data as DbRow[] | null) ?? [])
            .map(messageFromRow)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          const refreshedMessagesByRoom = groupBy(refreshedMessages, (message) => message.roomId);
          const dmRooms = (roomRefresh.data as DbRow[]).map((row) =>
            roomFromRow(
              row,
              refreshedMembers.filter((m) => roomIdFromRow(m) === row.id),
              refreshedMessagesByRoom.get(row.id) ?? [],
              tasksByRoom.get(row.id)?.map((task) => task.id) ?? [],
              memoryByRoom.get(row.id)?.map((entry) => entry.id) ?? [],
            ),
          );
          const dmIds = new Set(dmRooms.map((r) => r.id));
          finalRooms = [...dmRooms, ...rooms.filter((r) => !dmIds.has(r.id))].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          );
        }
        if (!topicsRefresh.error && topicsRefresh.data) {
          finalTopics = (topicsRefresh.data as DbRow[]).map(topicFromRow);
        }
        if (!topicMembersRefresh.error && topicMembersRefresh.data) {
          finalTopicMembers = (topicMembersRefresh.data as DbRow[]).map(topicMemberFromRow);
        }
      }
    } catch {
      const merged = mergeMayaIntoState(
        { employees: finalEmployees, rooms: finalRooms, topics: finalTopics, topicMembers: finalTopicMembers, workspace },
        profile.id,
        mayaWelcomeMessage(profile.name?.split(" ")[0] ?? "there"),
      );
      finalEmployees = merged.employees;
      finalRooms = merged.rooms;
      finalTopics = merged.topics ?? finalTopics;
      finalTopicMembers = merged.topicMembers ?? finalTopicMembers;
    }
  }

  const mergedState = mergeMayaIntoState(
    {
      employees: finalEmployees,
      rooms: finalRooms,
      topics: finalTopics,
      topicMembers: finalTopicMembers,
      workspace,
    },
    profile.id,
    mayaWelcomeMessage(profile.name?.split(" ")[0] ?? "there"),
  );

  return {
    version: buildDemoState().version,
    user: profile,
    workspace,
    workspaceMembers,
    workspaceInvitations,
    onboardingComplete: Boolean(workspaceRow.onboarding_complete),
    employees: mergedState.employees,
    rooms: mergedState.rooms,
    topics: mergedState.topics ?? finalTopics,
    topicMembers: mergedState.topicMembers ?? finalTopicMembers,
    tasks,
    memory,
    approvals,
    workLog,
    tools,
    calls,
    settings: { mode: "live", activeProvider: "siliconflow" },
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }
  return grouped;
}

function uniqueRowsById(rows: DbRow[]): DbRow[] {
  const seen = new Set<string>();
  const unique: DbRow[] = [];
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

async function fetchProfiles(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map<string, HumanUser>();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .in("id", ids);

  if (error) throw error;
  return new Map(
    ((data as DbRow[] | null) ?? []).map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        email: row.email,
        avatar: row.avatar ?? undefined,
        role: row.role ?? "Member",
      } satisfies HumanUser,
    ]),
  );
}

async function fetchWorkspaces(workspaceIds: string[]) {
  const ids = [...new Set(workspaceIds.filter(Boolean))];
  if (!ids.length) return new Map<string, Workspace>();

  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .in("id", ids);

  if (error) throw error;
  return new Map(((data as DbRow[] | null) ?? []).map((row) => [row.id, workspaceFromRow(row)]));
}

async function hydrateWorkspaceMembers(rows: DbRow[]): Promise<WorkspaceMember[]> {
  const profiles = await fetchProfiles(rows.map((row) => row.user_id));
  return rows
    .map((row) => {
      const profile = profiles.get(row.user_id);
      return {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        name: profile?.name,
        email: profile?.email,
        role: row.role as WorkspaceMemberRole,
        createdAt: row.created_at ?? nowISO(),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function hydrateWorkspaceInvitations(rows: DbRow[]): Promise<WorkspaceInvitation[]> {
  const unique = uniqueRowsById(rows);
  const workspaces = await fetchWorkspaces(unique.map((row) => row.workspace_id));
  const profiles = await fetchProfiles(unique.map((row) => row.invited_by));

  return unique
    .map((row) => invitationFromRow(row, workspaces.get(row.workspace_id), profiles.get(row.invited_by)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function invitationFromRow(
  row: DbRow,
  workspace?: Workspace,
  invitedBy?: HumanUser,
): WorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: workspace?.name,
    invitedEmail: row.invited_email,
    invitedBy: row.invited_by,
    invitedByName: invitedBy?.name,
    role: row.role,
    status: row.status,
    token: row.token,
    expiresAt: row.expires_at ?? undefined,
    acceptedBy: row.accepted_by ?? undefined,
    acceptedAt: row.accepted_at ?? undefined,
    createdAt: row.created_at ?? nowISO(),
    updatedAt: row.updated_at ?? row.created_at ?? nowISO(),
  };
}

function toolFromRow(row: DbRow): Tool {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    status: row.status,
  };
}

function employeeFromRow(row: DbRow, tools: ToolAccess[]): AIEmployee {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    roleKey: row.role_key,
    provider: normalizeLiveProvider(row.provider),
    model: row.model,
    modelMode: row.model_mode ?? undefined,
    seniority: row.seniority,
    status: effectiveEmployeeStatus({
      id: String(row.id),
      systemEmployeeKey: row.system_employee_key ? String(row.system_employee_key) : undefined,
      status: row.status,
    }),
    currentTask: row.current_task ?? undefined,
    instructions: row.instructions,
    communicationStyle: row.communication_style,
    successCriteria: row.success_criteria,
    tools,
    permissions: jsonObject<EmployeePermissions>(row.permissions, {} as EmployeePermissions),
    memoryCount: row.memory_count ?? 0,
    tasksCompleted: row.tasks_completed ?? 0,
    messagesSent: row.messages_sent ?? 0,
    approvalsRequested: row.approvals_requested ?? 0,
    avgResponseTime: row.avg_response_time ?? "-",
    trustScore: row.trust_score ?? 75,
    accent: row.accent ?? "#2f6fed",
    defaultRoomId: row.default_room_id ?? undefined,
    participationStyle: row.participation_style ?? "balanced_teammate",
    isSystemEmployee: Boolean(row.is_system_employee),
    systemEmployeeKey: row.system_employee_key ?? undefined,
    metadata: jsonObject<SystemEmployeeMetadata>(row.metadata, {}),
    lastActiveAt: row.last_active_at ?? row.updated_at ?? nowISO(),
    createdAt: row.created_at ?? nowISO(),
  };
}

function roomFromRow(
  row: DbRow,
  members: DbRow[],
  messages: RoomMessage[],
  taskIds: string[],
  memoryIds: string[],
): ProjectRoom {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    dmEmployeeId: row.dm_employee_id ?? undefined,
    description: row.description ?? "",
    brief: row.brief ?? "",
    humans: members.filter((m) => m.member_type === "human").map((m) => m.member_id),
    aiEmployees: members.filter((m) => m.member_type === "ai").map((m) => m.member_id),
    messages,
    tasks: taskIds,
    memory: memoryIds,
    unread: row.unread ?? 0,
    accent: row.accent ?? "#2f6fed",
    status: (row.status as import("@/lib/types").RoomStatus) ?? "active",
    createdAt: row.created_at ?? nowISO(),
    updatedAt: row.updated_at ?? row.created_at ?? nowISO(),
  };
}

function messageFromRow(row: DbRow): RoomMessage {
  return normalizeHumanDelivery({
    id: row.id,
    roomId: roomIdFromRow(row),
    topicId: row.topic_id ?? undefined,
    senderType: row.sender_type,
    senderId: row.sender_id,
    senderName: row.sender_name,
    content: row.content,
    mentions: jsonArray<string>(row.mentions),
    mentionsJson: jsonArray(row.mentions_json),
    agentRunId: row.agent_run_id ?? undefined,
    triggerMessageId: row.trigger_message_id ?? undefined,
    artifacts: row.artifacts ? jsonArray(row.artifacts) : undefined,
    pending: row.pending === true,
    createdAt: row.created_at ?? nowISO(),
  });
}

function taskFromRow(row: DbRow): Task {
  return {
    id: row.id,
    roomId: roomIdFromRow(row),
    topicId: row.topic_id ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    assigneeType: row.assignee_type,
    assigneeId: row.assignee_id,
    createdFrom: row.created_from ?? undefined,
    dueDate: row.due_date ?? undefined,
    createdAt: row.created_at ?? nowISO(),
    updatedAt: row.updated_at ?? row.created_at ?? nowISO(),
  };
}

function memoryFromRow(row: DbRow): MemoryEntry {
  return {
    id: row.id,
    roomId: roomIdFromRow(row),
    topicId: row.topic_id ?? undefined,
    type: row.type,
    title: row.title,
    content: row.content,
    status: row.status,
    createdByType: row.created_by_type,
    createdById: row.created_by_id,
    createdAt: row.created_at ?? nowISO(),
  };
}

function approvalFromRow(row: DbRow): Approval {
  return {
    id: row.id,
    roomId: roomIdFromRow(row),
    topicId: row.topic_id ?? undefined,
    requestedBy: row.requested_by,
    title: row.title,
    description: row.description ?? "",
    risk: row.risk,
    status: row.status,
    actionType: row.action_type,
    createdAt: row.created_at ?? nowISO(),
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function workLogFromRow(row: DbRow): WorkLogEvent {
  return {
    id: row.id,
    roomId: roomIdFromRow(row),
    topicId: row.topic_id ?? undefined,
    employeeId: row.employee_id,
    action: row.action,
    summary: row.summary ?? "",
    toolUsed: row.tool_used ?? undefined,
    status: row.status,
    relatedEntityType: row.related_entity_type ?? undefined,
    relatedEntityId: row.related_entity_id ?? undefined,
    createdAt: row.created_at ?? nowISO(),
  };
}

function callFromRow(row: DbRow): Call {
  return {
    id: row.id,
    roomId: roomIdFromRow(row),
    title: row.title,
    status: row.status,
    participants: jsonArray(row.participants),
    transcript: jsonArray(row.transcript),
    actionItems: jsonArray(row.action_items),
    startedAt: row.started_at ?? nowISO(),
    endedAt: row.ended_at ?? undefined,
  };
}

function employeeRow(workspaceId: string, employee: AIEmployee): DbRow {
  return {
    workspace_id: workspaceId,
    id: employee.id,
    name: employee.name,
    role: employee.role,
    role_key: employee.roleKey,
    provider: normalizeLiveProvider(employee.provider),
    model: employee.model,
    model_mode: employee.modelMode ?? "balanced",
    seniority: employee.seniority,
    status: employee.status,
    current_task: employee.currentTask ?? null,
    instructions: employee.instructions,
    communication_style: employee.communicationStyle,
    success_criteria: employee.successCriteria,
    permissions: employee.permissions,
    memory_count: employee.memoryCount,
    tasks_completed: employee.tasksCompleted,
    messages_sent: employee.messagesSent,
    approvals_requested: employee.approvalsRequested,
    avg_response_time: employee.avgResponseTime,
    trust_score: employee.trustScore,
    accent: employee.accent,
    default_room_id: employee.defaultRoomId ?? null,
    participation_style: employee.participationStyle ?? "balanced_teammate",
    is_system_employee: employee.isSystemEmployee ?? false,
    system_employee_key: employee.systemEmployeeKey ?? null,
    metadata: employee.metadata ?? {},
    last_active_at: employee.lastActiveAt,
    created_at: employee.createdAt,
  };
}

function employeeToolRows(workspaceId: string, employee: AIEmployee): DbRow[] {
  return employee.tools.map((tool) => ({
    workspace_id: workspaceId,
    employee_id: employee.id,
    tool_id: tool.toolId,
    status: tool.status,
    permission: tool.permission,
    last_used_at: tool.lastUsedAt ?? null,
  }));
}

function roomRow(workspaceId: string, room: ProjectRoom): DbRow {
  return {
    workspace_id: workspaceId,
    id: room.id,
    name: room.name,
    kind: room.kind,
    dm_employee_id: room.dmEmployeeId ?? null,
    description: room.description,
    brief: room.brief,
    unread: room.unread,
    accent: room.accent,
    status: room.status ?? "active",
    created_at: room.createdAt,
    updated_at: room.updatedAt,
  };
}

function roomMemberRows(workspaceId: string, room: ProjectRoom): DbRow[] {
  return [
    ...room.humans.map((memberId) => ({
      workspace_id: workspaceId,
      room_id: room.id,
      member_type: "human",
      member_id: memberId,
    })),
    ...room.aiEmployees.map((memberId) => ({
      workspace_id: workspaceId,
      room_id: room.id,
      member_type: "ai",
      member_id: memberId,
    })),
  ];
}

function messageRow(workspaceId: string, message: RoomMessage): DbRow {
  return {
    workspace_id: workspaceId,
    id: message.id,
    room_id: message.roomId,
    topic_id: message.topicId ?? null,
    sender_type: message.senderType,
    sender_id: message.senderId,
    sender_name: message.senderName,
    content: message.content,
    mentions: message.mentions ?? [],
    mentions_json: message.mentionsJson ?? [],
    artifacts: message.artifacts ?? null,
    agent_run_id: message.agentRunId ?? null,
    trigger_message_id: message.triggerMessageId ?? null,
    pending: message.pending ?? false,
    created_at: message.createdAt,
  };
}

function taskRow(workspaceId: string, task: Task): DbRow {
  return {
    workspace_id: workspaceId,
    id: task.id,
    room_id: task.roomId,
    topic_id: task.topicId ?? null,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    assignee_type: task.assigneeType,
    assignee_id: task.assigneeId,
    created_from: task.createdFrom ?? null,
    due_date: task.dueDate ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function memoryRow(workspaceId: string, entry: MemoryEntry): DbRow {
  return {
    workspace_id: workspaceId,
    id: entry.id,
    room_id: entry.roomId,
    topic_id: entry.topicId ?? null,
    type: entry.type,
    title: entry.title,
    content: entry.content,
    status: entry.status,
    created_by_type: entry.createdByType,
    created_by_id: entry.createdById,
    created_at: entry.createdAt,
  };
}

function approvalRow(workspaceId: string, approval: Approval): DbRow {
  return {
    workspace_id: workspaceId,
    id: approval.id,
    room_id: approval.roomId,
    topic_id: approval.topicId ?? null,
    requested_by: approval.requestedBy,
    title: approval.title,
    description: approval.description,
    risk: approval.risk,
    status: approval.status,
    action_type: approval.actionType,
    created_at: approval.createdAt,
    resolved_at: approval.resolvedAt ?? null,
  };
}

function workLogRow(workspaceId: string, event: WorkLogEvent): DbRow {
  return {
    workspace_id: workspaceId,
    id: event.id,
    room_id: event.roomId,
    topic_id: event.topicId ?? null,
    employee_id: event.employeeId,
    action: event.action,
    summary: event.summary,
    tool_used: event.toolUsed ?? null,
    status: event.status,
    related_entity_type: event.relatedEntityType ?? null,
    related_entity_id: event.relatedEntityId ?? null,
    created_at: event.createdAt,
  };
}

function callRow(workspaceId: string, call: Call): DbRow {
  return {
    workspace_id: workspaceId,
    id: call.id,
    room_id: call.roomId,
    title: call.title,
    status: call.status,
    participants: call.participants,
    transcript: call.transcript,
    action_items: call.actionItems,
    started_at: call.startedAt,
    ended_at: call.endedAt ?? null,
  };
}

function transcriptRows(workspaceId: string, call: Call): DbRow[] {
  return call.transcript.map((line) => transcriptRow(workspaceId, call.id, line));
}

function transcriptRow(
  workspaceId: string,
  callId: string,
  line: CallTranscriptLine,
): DbRow {
  return {
    workspace_id: workspaceId,
    id: line.id,
    call_id: callId,
    speaker_id: line.speakerId,
    speaker_name: line.speakerName,
    text: line.text,
    created_at: line.createdAt,
  };
}

async function upsertRows(table: string, rows: DbRow[], onConflict: string) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

export async function seedWorkspaceState(state: DemoState) {
  const workspaceId = state.workspace.id;

  await ensureToolCatalogRemote();

  const { error: workspaceError } = await supabase
    .from("workspaces")
    .update({
      name: state.workspace.name,
      plan: state.workspace.plan,
      onboarding_complete: state.onboardingComplete,
    })
    .eq("id", workspaceId);
  if (workspaceError) throw workspaceError;

  await upsertRows(
    "workspace_tools",
    state.tools.map((tool) => ({
      workspace_id: workspaceId,
      tool_id: tool.id,
      status: tool.status,
    })),
    "workspace_id,tool_id",
  );

  await upsertRows(
    "ai_employees",
    state.employees.map((employee) => employeeRow(workspaceId, employee)),
    "workspace_id,id",
  );
  await upsertRows(
    "employee_tools",
    state.employees.flatMap((employee) => employeeToolRows(workspaceId, employee)),
    "workspace_id,employee_id,tool_id",
  );
  await upsertRows(
    "rooms",
    state.rooms.map((room) => roomRow(workspaceId, room)),
    "workspace_id,id",
  );
  await upsertRows(
    "room_members",
    state.rooms.flatMap((room) => roomMemberRows(workspaceId, room)),
    "workspace_id,room_id,member_type,member_id",
  );
  await upsertRows(
    "messages",
    state.rooms.flatMap((room) => room.messages.map((message) => messageRow(workspaceId, message))),
    "workspace_id,id",
  );
  await upsertRows(
    "tasks",
    state.tasks.map((task) => taskRow(workspaceId, task)),
    "workspace_id,id",
  );
  await upsertRows(
    "memory_entries",
    state.memory.map((entry) => memoryRow(workspaceId, entry)),
    "workspace_id,id",
  );
  await upsertRows(
    "approvals",
    state.approvals.map((approval) => approvalRow(workspaceId, approval)),
    "workspace_id,id",
  );
  await upsertRows(
    "work_log_events",
    state.workLog.map((event) => workLogRow(workspaceId, event)),
    "workspace_id,id",
  );
  await upsertRows(
    "calls",
    state.calls.map((call) => callRow(workspaceId, call)),
    "workspace_id,id",
  );
  await upsertRows(
    "call_transcripts",
    state.calls.flatMap((call) => transcriptRows(workspaceId, call)),
    "workspace_id,id",
  );
}

export async function resetWorkspaceToState(state: DemoState) {
  const workspaceId = state.workspace.id;
  const tables = [
    "call_transcripts",
    "calls",
    "work_log_events",
    "approvals",
    "memory_entries",
    "tasks",
    "messages",
    "room_members",
    "rooms",
    "employee_tools",
    "ai_employees",
    "workspace_tools",
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("workspace_id", workspaceId);
    if (error) throw error;
  }

  await seedWorkspaceState(state);
}

export async function persistProfile(userId: string, patch: Partial<HumanUser>) {
  const payload: DbRow = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.avatar !== undefined) payload.avatar = patch.avatar;
  if (patch.role !== undefined) payload.role = patch.role;

  if (!Object.keys(payload).length) return;

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", userId);

  if (error) throw error;
}

export async function persistWorkspace(
  workspaceId: string,
  patch: Partial<Workspace> & { onboardingComplete?: boolean },
) {
  const payload: DbRow = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.plan !== undefined) payload.plan = patch.plan;
  if (patch.onboardingComplete !== undefined) {
    payload.onboarding_complete = patch.onboardingComplete;
  }
  if (patch.workspaceMode !== undefined) {
    payload.workspace_mode = patch.workspaceMode;
  }

  if (!Object.keys(payload).length) return;

  const { error } = await supabase
    .from("workspaces")
    .update(payload)
    .eq("id", workspaceId);

  if (error) throw error;
}

export async function persistEmployee(workspaceId: string, employee: AIEmployee) {
  await upsertRows("ai_employees", [employeeRow(workspaceId, employee)], "workspace_id,id");
  const { error } = await supabase
    .from("employee_tools")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employee.id);
  if (error) throw error;
  await upsertRows("employee_tools", employeeToolRows(workspaceId, employee), "workspace_id,employee_id,tool_id");
}

export async function deleteEmployee(workspaceId: string, employeeId: string) {
  const { error } = await supabase
    .from("ai_employees")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId);
  if (error) throw error;
}

export async function persistRoomMetadata(workspaceId: string, room: ProjectRoom) {
  await upsertRows("rooms", [roomRow(workspaceId, room)], "workspace_id,id");
}

export async function persistRoom(workspaceId: string, room: ProjectRoom) {
  await persistRoomMetadata(workspaceId, room);
  await replaceRoomMembers(workspaceId, room);
}

export async function replaceRoomMembers(workspaceId: string, room: ProjectRoom) {
  const { error: deleteError } = await supabase
    .from("room_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("room_id", room.id);
  if (deleteError) throw deleteError;
  await upsertRows("room_members", roomMemberRows(workspaceId, room), "workspace_id,room_id,member_type,member_id");
}

export async function persistRoomMember(
  workspaceId: string,
  roomId: string,
  memberType: "human" | "ai",
  memberId: string,
) {
  await upsertRows(
    "room_members",
    [
      {
        workspace_id: workspaceId,
        room_id: roomId,
        member_type: memberType,
        member_id: memberId,
      },
    ],
    "workspace_id,room_id,member_type,member_id",
  );
}

export async function deleteRoomMember(
  workspaceId: string,
  roomId: string,
  memberType: "human" | "ai",
  memberId: string,
) {
  const { error } = await supabase
    .from("room_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId)
    .eq("member_type", memberType)
    .eq("member_id", memberId);
  if (error) throw error;
}

export async function persistMessage(workspaceId: string, message: RoomMessage) {
  await upsertRows("messages", [messageRow(workspaceId, message)], "workspace_id,id");
}

export async function persistTask(workspaceId: string, task: Task) {
  await upsertRows("tasks", [taskRow(workspaceId, task)], "workspace_id,id");
}

export async function persistMemory(workspaceId: string, entry: MemoryEntry) {
  await upsertRows("memory_entries", [memoryRow(workspaceId, entry)], "workspace_id,id");
}

export async function persistApproval(workspaceId: string, approval: Approval) {
  await upsertRows("approvals", [approvalRow(workspaceId, approval)], "workspace_id,id");
}

export async function persistWorkLog(workspaceId: string, event: WorkLogEvent) {
  await upsertRows("work_log_events", [workLogRow(workspaceId, event)], "workspace_id,id");
}

export async function persistCall(workspaceId: string, call: Call) {
  await upsertRows("calls", [callRow(workspaceId, call)], "workspace_id,id");
  await upsertRows("call_transcripts", transcriptRows(workspaceId, call), "workspace_id,id");
}

export async function persistCallTranscriptLine(
  workspaceId: string,
  callId: string,
  line: CallTranscriptLine,
) {
  await upsertRows("call_transcripts", [transcriptRow(workspaceId, callId, line)], "workspace_id,id");
}

export async function persistWorkspaceToolStatus(
  workspaceId: string,
  toolId: string,
  status: Tool["status"],
) {
  await upsertRows(
    "workspace_tools",
    [{ workspace_id: workspaceId, tool_id: toolId, status }],
    "workspace_id,tool_id",
  );
}

export async function createWorkspaceInvitation(
  workspaceId: string,
  invitedEmail: string,
  role: WorkspaceMemberRole,
  invitedBy: string,
): Promise<WorkspaceInvitation> {
  const { data, error } = await supabase
    .from("workspace_invitations")
    .insert({
      workspace_id: workspaceId,
      invited_email: invitedEmail.trim().toLowerCase(),
      invited_by: invitedBy,
      role,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) throw error;
  const hydrated = await hydrateWorkspaceInvitations([data]);
  return hydrated[0];
}

export async function acceptWorkspaceInvitation(
  user: User,
  invitation: WorkspaceInvitation,
): Promise<DemoState> {
  const { error: memberError } = await supabase.from("workspace_members").upsert(
    {
      workspace_id: invitation.workspaceId,
      user_id: user.id,
      role: invitation.role,
    },
    { onConflict: "workspace_id,user_id" },
  );

  if (memberError) throw memberError;

  const timestamp = nowISO();
  const { error: inviteError } = await supabase
    .from("workspace_invitations")
    .update({
      status: "accepted",
      accepted_by: user.id,
      accepted_at: timestamp,
    })
    .eq("id", invitation.id);

  if (inviteError) throw inviteError;
  return loadWorkspaceState(user, invitation.workspaceId);
}

export async function declineWorkspaceInvitation(invitationId: string) {
  const { error } = await supabase
    .from("workspace_invitations")
    .update({ status: "declined" })
    .eq("id", invitationId);

  if (error) throw error;
}

export async function revokeWorkspaceInvitation(invitationId: string) {
  const { error } = await supabase
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId);

  if (error) throw error;
}
