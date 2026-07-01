import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AIEmployee,
  Approval,
  EmployeePermissions,
  MemoryEntry,
  MentionRef,
  MessageArtifact,
  ProjectRoom,
  RoomMessage,
  RoomTopic,
  Task,
  ToolAccess,
  WorkLogEvent,
} from "@/lib/types";
import { refreshTopicStats } from "@/lib/server/topic-stats";
import { ensureGeneralTopic, topicFromRow } from "@/lib/server/topic-helpers";
import { defaultModelModeForRole, normalizeModelMode } from "@/lib/ai/model-catalog";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import { extractMentions, nowISO, uid } from "@/lib/utils";

type DbRow = Record<string, unknown>;

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function jsonObject<T extends object>(value: unknown, fallback: T): T {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : fallback;
}

function employeeFromRow(row: DbRow, tools: ToolAccess[]): AIEmployee {
  return {
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    roleKey: row.role_key as AIEmployee["roleKey"],
    provider: String(row.provider),
    model: String(row.model),
    modelMode: normalizeModelMode(
      row.model_mode ? String(row.model_mode) : defaultModelModeForRole(row.role_key as AIEmployee["roleKey"]),
    ),
    seniority: String(row.seniority),
    status: row.status as AIEmployee["status"],
    currentTask: row.current_task ? String(row.current_task) : undefined,
    instructions: String(row.instructions),
    communicationStyle: String(row.communication_style),
    successCriteria: String(row.success_criteria),
    tools,
    permissions: jsonObject<EmployeePermissions>(row.permissions, {} as EmployeePermissions),
    memoryCount: Number(row.memory_count ?? 0),
    tasksCompleted: Number(row.tasks_completed ?? 0),
    messagesSent: Number(row.messages_sent ?? 0),
    approvalsRequested: Number(row.approvals_requested ?? 0),
    avgResponseTime: String(row.avg_response_time ?? "-"),
    trustScore: Number(row.trust_score ?? 75),
    accent: String(row.accent ?? "#f97316"),
    defaultRoomId: row.default_channel_id ? String(row.default_channel_id) : undefined,
    participationStyle: row.participation_style
      ? (String(row.participation_style) as AIEmployee["participationStyle"])
      : "balanced_teammate",
    lastActiveAt: String(row.last_active_at ?? row.updated_at ?? nowISO()),
    createdAt: String(row.created_at ?? nowISO()),
  };
}

function messageFromRow(row: DbRow): RoomMessage {
  return {
    id: String(row.id),
    roomId: String(row.channel_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    senderType: row.sender_type as RoomMessage["senderType"],
    senderId: String(row.sender_id),
    senderName: String(row.sender_name),
    content: String(row.content),
    mentions: jsonArray<string>(row.mentions),
    mentionsJson: row.mentions_json
      ? (jsonArray(row.mentions_json) as MentionRef[])
      : undefined,
    agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
    triggerMessageId: row.trigger_message_id ? String(row.trigger_message_id) : undefined,
    artifacts: row.artifacts ? (jsonArray(row.artifacts) as MessageArtifact[]) : undefined,
    pending: Boolean(row.pending),
    createdAt: String(row.created_at ?? nowISO()),
  };
}

function memoryFromRow(row: DbRow): MemoryEntry {
  return {
    id: String(row.id),
    roomId: String(row.channel_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    type: row.type as MemoryEntry["type"],
    title: String(row.title),
    content: String(row.content),
    status: row.status as MemoryEntry["status"],
    createdByType: row.created_by_type as MemoryEntry["createdByType"],
    createdById: String(row.created_by_id),
    createdAt: String(row.created_at ?? nowISO()),
  };
}

export type RoomContext = {
  workspaceId: string;
  workspaceName: string;
  room: ProjectRoom;
  topic: RoomTopic;
  employees: AIEmployee[];
  recentMemory: MemoryEntry[];
  openTasks: Task[];
  topicApprovals: Approval[];
  topicWorkLogs: WorkLogEvent[];
  humanParticipants: { id: string; name: string }[];
};

export type RespondersContext = {
  room: Pick<ProjectRoom, "id" | "kind" | "dmEmployeeId">;
  employees: AIEmployee[];
};

function buildToolsByEmployee(toolsRows: DbRow[]): Map<string, ToolAccess[]> {
  const toolsByEmployee = new Map<string, ToolAccess[]>();
  for (const row of toolsRows) {
    const employeeId = String(row.employee_id);
    const access: ToolAccess = {
      toolId: String(row.tool_id),
      name: String(row.tool_id),
      category: "Productivity",
      status: (row.status as ToolAccess["status"]) ?? "mock",
      permission: (row.permission as ToolAccess["permission"]) ?? "read",
      lastUsedAt: row.last_used_at ? String(row.last_used_at) : undefined,
    };
    const list = toolsByEmployee.get(employeeId) ?? [];
    list.push(access);
    toolsByEmployee.set(employeeId, list);
  }
  return toolsByEmployee;
}

function employeesInRoom(
  roomRow: DbRow,
  members: DbRow[],
  employeeRows: DbRow[],
  toolsByEmployee: Map<string, ToolAccess[]>,
): AIEmployee[] {
  const aiIds = members.filter((m) => m.member_type === "ai").map((m) => String(m.member_id));
  const employees = employeeRows
    .filter((row) => aiIds.includes(String(row.id)))
    .map((row) => employeeFromRow(row, toolsByEmployee.get(String(row.id)) ?? []));

  if (roomRow.kind === "dm" && roomRow.dm_employee_id) {
    const dmId = String(roomRow.dm_employee_id);
    if (!employees.some((e) => e.id === dmId)) {
      const dmRow = employeeRows.find((row) => String(row.id) === dmId);
      if (dmRow) {
        employees.push(employeeFromRow(dmRow, toolsByEmployee.get(dmId) ?? []));
      }
    }
  }

  return employees;
}

/** Lightweight load for the message POST route — room employees only, no AI context. */
export async function loadRespondersContext(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<RespondersContext> {
  const [roomResult, membersResult, employeesResult, toolsResult] = await Promise.all([
    client
      .from("channels")
      .select("id, kind, dm_employee_id")
      .eq("workspace_id", workspaceId)
      .eq("id", roomId)
      .single(),
    client
      .from("channel_members")
      .select("member_type, member_id")
      .eq("workspace_id", workspaceId)
      .eq("channel_id", roomId),
    client.from("ai_employees").select("*").eq("workspace_id", workspaceId),
    client.from("employee_tools").select("*").eq("workspace_id", workspaceId),
  ]);

  if (roomResult.error) throw roomResult.error;

  const roomRow = roomResult.data as DbRow;
  const toolsByEmployee = buildToolsByEmployee((toolsResult.data as DbRow[] | null) ?? []);
  const employees = employeesInRoom(
    roomRow,
    (membersResult.data as DbRow[] | null) ?? [],
    (employeesResult.data as DbRow[] | null) ?? [],
    toolsByEmployee,
  );

  return {
    room: {
      id: String(roomRow.id),
      kind: roomRow.kind as ProjectRoom["kind"],
      dmEmployeeId: roomRow.dm_employee_id ? String(roomRow.dm_employee_id) : undefined,
    },
    employees,
  };
}

export type LoadTopicContextOptions = {
  /** Smaller fetches for DM threads — faster model calls. */
  lean?: boolean;
};

export async function loadTopicContext(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
  options: LoadTopicContextOptions = {},
): Promise<RoomContext> {
  const topicResult = await client
    .from("channel_topics")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("channel_id", roomId)
    .eq("id", topicId)
    .single();
  if (topicResult.error) throw topicResult.error;
  const topic = topicFromRow(topicResult.data as DbRow);
  if (topic.status === "archived") {
    throw new Error("This topic is archived.");
  }

  const roomResult = await client
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", roomId)
    .single();
  if (roomResult.error) throw roomResult.error;
  const roomRow = roomResult.data as DbRow;
  if (String(roomRow.status ?? "active") === "archived") {
    throw new Error("This channel is archived.");
  }
  const lean = options.lean ?? roomRow.kind === "dm";
  const messageLimit = lean ? 12 : 50;
  const memoryLimit = lean ? 6 : 12;
  const pinnedLimit = lean ? 3 : 6;

  const membersResult = await client
    .from("channel_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("channel_id", roomId);

  const members = (membersResult.data as DbRow[] | null) ?? [];
  const humanIds = members.filter((m) => m.member_type === "human").map((m) => String(m.member_id));
  const aiIds = members.filter((m) => m.member_type === "ai").map((m) => String(m.member_id));

  const [
    workspaceResult,
    messagesResult,
    employeesResult,
    employeeToolsResult,
    topicMemoryResult,
    roomPinnedMemoryResult,
    tasksResult,
    approvalsResult,
    workLogsResult,
    profilesResult,
  ] = await Promise.all([
    client.from("workspaces").select("id, name").eq("id", workspaceId).single(),
    client
      .from("messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("channel_id", roomId)
      .eq("topic_id", topicId)
      .order("created_at", { ascending: true })
      .limit(messageLimit),
    client.from("ai_employees").select("*").eq("workspace_id", workspaceId),
    client.from("employee_tools").select("*").eq("workspace_id", workspaceId),
    client
      .from("memory_entries")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("topic_id", topicId)
      .order("created_at", { ascending: false })
      .limit(memoryLimit),
    client
      .from("memory_entries")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("channel_id", roomId)
      .in("status", ["pinned", "approved"])
      .is("topic_id", null)
      .order("created_at", { ascending: false })
      .limit(pinnedLimit),
    client
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("topic_id", topicId)
      .in("status", ["open", "in_progress", "waiting_approval", "blocked"])
      .limit(lean ? 8 : 50),
    lean
      ? Promise.resolve({ data: [], error: null })
      : client
          .from("approvals")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("topic_id", topicId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(10),
    lean
      ? Promise.resolve({ data: [], error: null })
      : client
          .from("work_log_events")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("topic_id", topicId)
          .order("created_at", { ascending: false })
          .limit(15),
    humanIds.length
      ? client.from("profiles").select("id, name").in("id", humanIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (workspaceResult.error) throw workspaceResult.error;

  const profiles = new Map(
    ((profilesResult.data as DbRow[] | null) ?? []).map((p) => [String(p.id), String(p.name)]),
  );

  const toolsByEmployee = buildToolsByEmployee((employeeToolsResult.data as DbRow[] | null) ?? []);
  const employees = employeesInRoom(
    roomRow,
    members,
    (employeesResult.data as DbRow[] | null) ?? [],
    toolsByEmployee,
  );

  const messages = ((messagesResult.data as DbRow[] | null) ?? []).map(messageFromRow);
  const topicMemory = ((topicMemoryResult.data as DbRow[] | null) ?? []).map(memoryFromRow);
  const roomPinned = ((roomPinnedMemoryResult.data as DbRow[] | null) ?? []).map(memoryFromRow);
  const memory = [...topicMemory, ...roomPinned];

  const openTasks = ((tasksResult.data as DbRow[] | null) ?? []).map((row) => ({
    id: String(row.id),
    roomId: String(row.channel_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    assigneeType: row.assignee_type as Task["assigneeType"],
    assigneeId: String(row.assignee_id),
    createdFrom: row.created_from ? String(row.created_from) : undefined,
    dueDate: row.due_date ? String(row.due_date) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? nowISO()),
  }));

  const topicApprovals = ((approvalsResult.data as DbRow[] | null) ?? []).map((row) => ({
    id: String(row.id),
    roomId: String(row.channel_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    requestedBy: String(row.requested_by),
    title: String(row.title),
    description: String(row.description ?? ""),
    risk: row.risk as Approval["risk"],
    status: row.status as Approval["status"],
    actionType: row.action_type as Approval["actionType"],
    createdAt: String(row.created_at ?? nowISO()),
  }));

  const topicWorkLogs = ((workLogsResult.data as DbRow[] | null) ?? []).map((row) => ({
    id: String(row.id),
    roomId: String(row.channel_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    employeeId: String(row.employee_id),
    action: String(row.action),
    summary: String(row.summary),
    toolUsed: row.tool_used ? String(row.tool_used) : undefined,
    status: row.status as WorkLogEvent["status"],
    relatedEntityType: row.related_entity_type as WorkLogEvent["relatedEntityType"],
    relatedEntityId: row.related_entity_id ? String(row.related_entity_id) : undefined,
    agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
  }));

  const room: ProjectRoom = {
    id: String(roomRow.id),
    name: String(roomRow.name),
    kind: roomRow.kind as ProjectRoom["kind"],
    dmEmployeeId: roomRow.dm_employee_id ? String(roomRow.dm_employee_id) : undefined,
    description: String(roomRow.description ?? ""),
    brief: String(roomRow.brief ?? ""),
    humans: humanIds,
    aiEmployees: aiIds,
    messages,
    tasks: openTasks.map((t) => t.id),
    memory: memory.map((m) => m.id),
    unread: Number(roomRow.unread ?? 0),
    accent: String(roomRow.accent ?? "#f97316"),
    createdAt: String(roomRow.created_at ?? nowISO()),
    updatedAt: String(roomRow.updated_at ?? nowISO()),
  };

  return {
    workspaceId,
    workspaceName: String((workspaceResult.data as DbRow).name),
    room,
    topic,
    employees,
    recentMemory: memory,
    openTasks,
    topicApprovals,
    topicWorkLogs,
    humanParticipants: humanIds.map((id) => ({
      id,
      name: profiles.get(id) ?? "Teammate",
    })),
  };
}

/** @deprecated Use loadTopicContext */
export async function loadRoomContext(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<RoomContext> {
  const general = await ensureGeneralTopic(client, workspaceId, roomId);
  return loadTopicContext(client, workspaceId, roomId, general.id);
}

export function parseEmployeeMentions(
  content: string,
  employees: AIEmployee[],
  mentionsJson?: MentionRef[],
): AIEmployee[] {
  if (mentionsJson?.length) {
    const ids = mentionsJson
      .filter((m) => m.type === "ai_employee")
      .map((m) => m.id);
    return employees.filter((e) => ids.includes(e.id));
  }

  const ids = extractMentions(
    content,
    employees.map((e) => ({ id: e.id, name: e.name })),
  );
  return employees.filter((e) => ids.includes(e.id));
}

export async function insertHumanMessage(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  user: { id: string; name: string },
  content: string,
  topicId: string,
  clientMessageId?: string,
  mentionsJson?: MentionRef[],
): Promise<RoomMessage> {
  const legacyMentions = mentionsJson?.length
    ? mentionsJson.map((m) => m.id)
    : extractMentions(content, []);
  const message: RoomMessage = {
    id: clientMessageId ?? uid("msg"),
    roomId,
    topicId,
    senderType: "human",
    senderId: user.id,
    senderName: user.name,
    content,
    mentions: legacyMentions,
    mentionsJson,
    createdAt: nowISO(),
  };

  const { error } = await client.from("messages").insert({
    workspace_id: workspaceId,
    id: message.id,
    channel_id: roomId,
    topic_id: topicId,
    sender_type: message.senderType,
    sender_id: message.senderId,
    sender_name: message.senderName,
    content: message.content,
    mentions: message.mentions,
    mentions_json: mentionsJson ?? [],
    pending: false,
    created_at: message.createdAt,
  });

  if (error) throw error;
  void refreshTopicStats(client, topicId).catch((err) => {
    console.error("[AdeHQ] topic stats refresh failed", err);
  });
  return message;
}

export async function persistEmployeeEffects(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
  employee: AIEmployee,
  reply: string,
  effect: {
    workLog: Array<Partial<WorkLogEvent>>;
    tasks: Array<Partial<Task>>;
    memory: Array<Partial<MemoryEntry>>;
    approvals: Array<Partial<Approval>>;
    emailDrafts?: Array<{
      subject: string;
      body: string;
      recipient?: string;
      company?: string;
    }>;
    statusChange?: AIEmployee["status"];
    currentTask?: string;
  },
  triggerMessageId?: string,
  agentRunId?: string,
): Promise<{ aiMessage: RoomMessage; artifacts: MessageArtifact[] }> {
  reply = sanitizeReplyForChat(reply);
  const artifacts: MessageArtifact[] = [];
  const createdTaskIds: string[] = [];
  const createdMemoryIds: string[] = [];
  const createdApprovalIds: string[] = [];

  for (const draft of effect.memory) {
    const entry: MemoryEntry = {
      id: uid("mem"),
      roomId,
      topicId,
      type: draft.type ?? "general",
      title: draft.title ?? "Note",
      content: draft.content ?? "",
      status: draft.status ?? "draft",
      createdByType: "ai",
      createdById: employee.id,
      createdAt: nowISO(),
    };
    const { error } = await client.from("memory_entries").insert({
      workspace_id: workspaceId,
      id: entry.id,
      channel_id: roomId,
      topic_id: topicId,
      type: entry.type,
      title: entry.title,
      content: entry.content,
      status: entry.status,
      created_by_type: entry.createdByType,
      created_by_id: entry.createdById,
      created_by_run_id: agentRunId ?? null,
      created_at: entry.createdAt,
    });
    if (error) throw error;
    createdMemoryIds.push(entry.id);
  }

  for (const draft of effect.tasks) {
    const task: Task = {
      id: uid("task"),
      roomId,
      topicId,
      title: draft.title ?? "Task",
      description: draft.description,
      status: draft.status ?? "open",
      priority: draft.priority ?? "medium",
      assigneeType: draft.assigneeType ?? "ai",
      assigneeId: draft.assigneeId ?? employee.id,
      createdFrom: draft.createdFrom,
      dueDate: draft.dueDate,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    const { error } = await client.from("tasks").insert({
      workspace_id: workspaceId,
      id: task.id,
      channel_id: roomId,
      topic_id: topicId,
      title: task.title,
      description: task.description ?? null,
      status: task.status,
      priority: task.priority,
      assignee_type: task.assigneeType,
      assignee_id: task.assigneeId,
      created_from: task.createdFrom ?? null,
      created_by_run_id: agentRunId ?? null,
      due_date: task.dueDate ?? null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    });
    if (error) throw error;
    createdTaskIds.push(task.id);
  }

  if (createdTaskIds.length) {
    artifacts.push({
      type: "task",
      id: createdTaskIds[0],
      label: `${createdTaskIds.length} task${createdTaskIds.length === 1 ? "" : "s"} created`,
    });
  }

  if (createdMemoryIds.length) {
    const firstTitle = effect.memory[0]?.title ?? "Note";
    artifacts.push({
      type: "memory",
      id: createdMemoryIds[0],
      label: `Saved to memory: ${firstTitle.slice(0, 40)}`,
    });
  }

  for (const draft of effect.emailDrafts ?? []) {
    artifacts.push({
      type: "email_draft",
      id: uid("draft"),
      label: draft.recipient
        ? `Email draft: ${draft.recipient}${draft.company ? ` @ ${draft.company}` : ""}`
        : `Email draft: ${draft.subject.slice(0, 48)}`,
      meta: {
        subject: draft.subject,
        body: draft.body,
        recipient: draft.recipient,
        company: draft.company,
      },
    });
  }

  for (const draft of effect.approvals) {
    const approval: Approval = {
      id: uid("appr"),
      roomId,
      topicId,
      requestedBy: employee.id,
      title: draft.title ?? "Approval request",
      description: draft.description ?? "",
      risk: draft.risk ?? "medium",
      status: "pending",
      actionType: draft.actionType ?? "external_action",
      createdAt: nowISO(),
    };
    const { error } = await client.from("approvals").insert({
      workspace_id: workspaceId,
      id: approval.id,
      channel_id: roomId,
      topic_id: topicId,
      requested_by: approval.requestedBy,
      title: approval.title,
      description: approval.description,
      risk: approval.risk,
      status: approval.status,
      action_type: approval.actionType,
      created_by_run_id: agentRunId ?? null,
      created_at: approval.createdAt,
    });
    if (error) throw error;
    createdApprovalIds.push(approval.id);
    artifacts.push({
      type: "approval",
      id: approval.id,
      label: `Approval: ${approval.title.slice(0, 28)}`,
    });
  }

  const workLogCount = effect.workLog.length;
  for (const draft of effect.workLog) {
    const event: WorkLogEvent = {
      id: uid("wl"),
      roomId,
      topicId,
      employeeId: employee.id,
      action: draft.action ?? "Worked",
      summary: draft.summary ?? "",
      toolUsed: draft.toolUsed,
      status: draft.status ?? "success",
      relatedEntityType: draft.relatedEntityType,
      relatedEntityId:
        draft.relatedEntityId ??
        (draft.relatedEntityType === "task"
          ? createdTaskIds[0]
          : draft.relatedEntityType === "memory"
            ? createdMemoryIds[0]
            : draft.relatedEntityType === "approval"
              ? createdApprovalIds[0]
              : draft.relatedEntityType === "message"
                ? triggerMessageId
                : undefined),
      createdAt: nowISO(),
    };
    const { error } = await client.from("work_log_events").insert({
      workspace_id: workspaceId,
      id: event.id,
      channel_id: roomId,
      topic_id: topicId,
      employee_id: event.employeeId,
      action: event.action,
      summary: event.summary,
      tool_used: event.toolUsed ?? null,
      status: event.status,
      related_entity_type: event.relatedEntityType ?? null,
      related_entity_id: event.relatedEntityId ?? null,
      agent_run_id: agentRunId ?? null,
      created_at: event.createdAt,
    });
    if (error) throw error;
  }

  if (workLogCount) {
    artifacts.push({
      type: "work_log",
      id: uid("wl-art"),
      label: `${workLogCount} work log event${workLogCount === 1 ? "" : "s"}`,
    });
  }

  const aiMessage: RoomMessage = {
    id: uid("msg"),
    roomId,
    topicId,
    senderType: "ai",
    senderId: employee.id,
    senderName: employee.name,
    content: reply,
    artifacts: artifacts.length ? artifacts : undefined,
    createdAt: nowISO(),
  };

  const { error: messageError } = await client.from("messages").insert({
    workspace_id: workspaceId,
    id: aiMessage.id,
    channel_id: roomId,
    topic_id: topicId,
    sender_type: aiMessage.senderType,
    sender_id: aiMessage.senderId,
    sender_name: aiMessage.senderName,
    content: aiMessage.content,
    mentions: [],
    mentions_json: [],
    artifacts: aiMessage.artifacts ?? null,
    agent_run_id: agentRunId ?? null,
    trigger_message_id: triggerMessageId ?? null,
    pending: false,
    created_at: aiMessage.createdAt,
  });
  if (messageError) throw messageError;

  const nextStatus = effect.statusChange ?? "idle";
  const { error: employeeError } = await client
    .from("ai_employees")
    .update({
      status: nextStatus,
      current_task: effect.currentTask ?? employee.currentTask ?? null,
      messages_sent: (employee.messagesSent ?? 0) + 1,
      memory_count: (employee.memoryCount ?? 0) + createdMemoryIds.length,
      approvals_requested: (employee.approvalsRequested ?? 0) + createdApprovalIds.length,
      last_active_at: nowISO(),
      updated_at: nowISO(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", employee.id);
  if (employeeError) throw employeeError;

  await refreshTopicStats(client, topicId);

  return { aiMessage, artifacts };
}

export async function getWorkspaceIdForRoom(
  client: SupabaseClient,
  roomId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("channels")
    .select("workspace_id")
    .eq("id", roomId)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.workspace_id ? String(data[0].workspace_id) : null;
}
