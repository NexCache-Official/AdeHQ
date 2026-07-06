import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AIEmployee,
  Approval,
  ArtifactEffect,
  EmployeePermissions,
  FileCitationEffect,
  MemoryEntry,
  MemorySuggestionEffect,
  MentionRef,
  MessageArtifact,
  ProjectRoom,
  RoomMessage,
  RoomTopic,
  Task,
  ToolAccess,
  WorkLogEvent,
} from "@/lib/types";
import { normalizeHumanDelivery } from "@/lib/message-delivery";
import { roomIdFromRow } from "@/lib/server/db-row";
import { refreshTopicStats } from "@/lib/server/topic-stats";
import { ensureGeneralTopic, topicFromRow } from "@/lib/server/topic-helpers";
import { fetchTopicSummary } from "@/lib/topic-summary/persistence";
import {
  buildImportedContextBlock,
  getTopicContextImportsForTopic,
} from "@/lib/topics/context-imports";
import { defaultModelModeForRole, normalizeModelMode } from "@/lib/ai/model-catalog";
import { normalizeIntelligencePolicy } from "@/lib/ai/intelligence-policy";
import type { EmployeeIntelligencePolicy } from "@/lib/types";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import {
  artifactWorkLogAction,
  insertWorkGraphEdge,
  type FileContextBundle,
  validateCitations,
} from "@/lib/server/file-context";
import { syncArtifactToStorage } from "@/lib/drive/storage-sync";
import {
  buildEmailDraftJson,
  emailMarkdownFromJson,
  extractArtifactFromMessage,
  type EmailDraftJson,
} from "@/lib/artifacts/intelligence";
import { recordAiMessageInTopicOrchestrationState } from "@/lib/orchestration/room-steward";
import { executeEmployeeToolCalls } from "@/lib/integrations/manager";
import type { ToolCallEffectItem } from "@/lib/types";
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
    accent: String(row.accent ?? "#2f6fed"),
    defaultRoomId: row.default_room_id ? String(row.default_room_id) : undefined,
    participationStyle: row.participation_style
      ? (String(row.participation_style) as AIEmployee["participationStyle"])
      : "balanced_teammate",
    intelligencePolicy: normalizeIntelligencePolicy(
      row.intelligence_policy
        ? jsonObject<EmployeeIntelligencePolicy>(row.intelligence_policy, {
            defaultMode: "balanced",
            allowedModes: ["efficient", "balanced", "strong"],
            workHourProfile: "moderate",
            browserAccess: "none",
            routingPreference: "auto",
          })
        : undefined,
      {
        modelMode: normalizeModelMode(
          row.model_mode ? String(row.model_mode) : defaultModelModeForRole(row.role_key as AIEmployee["roleKey"]),
        ),
        roleKey: row.role_key as AIEmployee["roleKey"],
      },
    ),
    lastActiveAt: String(row.last_active_at ?? row.updated_at ?? nowISO()),
    createdAt: String(row.created_at ?? nowISO()),
  };
}

function messageFromRow(row: DbRow): RoomMessage {
  return normalizeHumanDelivery({
    id: String(row.id),
    roomId: roomIdFromRow(row),
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
    pending: row.pending === true,
    clientMessageId: row.client_message_id ? String(row.client_message_id) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
  });
}

function memoryFromRow(row: DbRow): MemoryEntry {
  return {
    id: String(row.id),
    roomId: roomIdFromRow(row),
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
  topicSummary: import("@/lib/topic-summary/types").TopicSummary | null;
  employees: AIEmployee[];
  recentMemory: MemoryEntry[];
  openTasks: Task[];
  topicApprovals: Approval[];
  topicWorkLogs: WorkLogEvent[];
  humanParticipants: { id: string; name: string }[];
  importedContextBlock?: string;
  topicContextImports?: import("@/lib/topics/context-imports").TopicContextImportRecord[];
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
      .from("rooms")
      .select("id, kind, dm_employee_id")
      .eq("workspace_id", workspaceId)
      .eq("id", roomId)
      .single(),
    client
      .from("room_members")
      .select("member_type, member_id")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId),
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
    .from("topics")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId)
    .eq("id", topicId)
    .single();
  if (topicResult.error) throw topicResult.error;
  const topic = topicFromRow(topicResult.data as DbRow);
  if (topic.status === "archived") {
    throw new Error("This topic is archived.");
  }

  const topicSummary = await fetchTopicSummary(client, workspaceId, topicId);
  const topicContextImports = await getTopicContextImportsForTopic(client, workspaceId, topicId);
  const importedContextBlock = buildImportedContextBlock(topicContextImports);

  const roomResult = await client
    .from("rooms")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", roomId)
    .single();
  if (roomResult.error) throw roomResult.error;
  const roomRow = roomResult.data as DbRow;
  if (String(roomRow.status ?? "active") === "archived") {
    throw new Error("This room is archived.");
  }
  const lean = options.lean ?? roomRow.kind === "dm";
  const messageLimit = lean ? 12 : 50;
  const memoryLimit = lean ? 6 : 12;
  const pinnedLimit = lean ? 3 : 6;

  const membersResult = await client
    .from("room_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId);

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
      .eq("room_id", roomId)
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
      .eq("room_id", roomId)
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
    roomId: roomIdFromRow(row),
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
    roomId: roomIdFromRow(row),
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
    roomId: roomIdFromRow(row),
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
    accent: String(roomRow.accent ?? "#2f6fed"),
    createdAt: String(roomRow.created_at ?? nowISO()),
    updatedAt: String(roomRow.updated_at ?? nowISO()),
  };

  return {
    workspaceId,
    workspaceName: String((workspaceResult.data as DbRow).name),
    room,
    topic,
    topicSummary,
    employees,
    recentMemory: memory,
    openTasks,
    topicApprovals,
    topicWorkLogs,
    humanParticipants: humanIds.map((id) => ({
      id,
      name: profiles.get(id) ?? "Teammate",
    })),
    importedContextBlock: importedContextBlock || undefined,
    topicContextImports,
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
  const id = clientMessageId ?? uid("msg");
  const clientId = clientMessageId ?? id;

  if (clientId) {
    const { data: existing, error: lookupError } = await client
      .from("messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("client_message_id", clientId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) return messageFromRow(existing as DbRow);
  }

  const message: RoomMessage = {
    id,
    roomId,
    topicId,
    senderType: "human",
    senderId: user.id,
    senderName: user.name,
    content,
    mentions: legacyMentions,
    mentionsJson,
    clientMessageId: clientId,
    createdAt: nowISO(),
  };

  const { error } = await client.from("messages").insert({
    workspace_id: workspaceId,
    id: message.id,
    client_message_id: clientId,
    room_id: roomId,
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

  if (error?.code === "23505" && clientId) {
    const { data: existing, error: refetchError } = await client
      .from("messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("client_message_id", clientId)
      .maybeSingle();
    if (refetchError) throw refetchError;
    if (existing) return messageFromRow(existing as DbRow);
  }

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
    citations?: FileCitationEffect[];
    artifacts?: ArtifactEffect[];
    memorySuggestions?: MemorySuggestionEffect[];
    toolCalls?: ToolCallEffectItem[];
    statusChange?: AIEmployee["status"];
    currentTask?: string;
  },
  triggerMessageId?: string,
  agentRunId?: string,
  options?: {
    fileContext?: FileContextBundle | null;
    usedFileContext?: boolean;
    mentionsJson?: MentionRef[];
  },
): Promise<{ aiMessage: RoomMessage; artifacts: MessageArtifact[] }> {
  reply = sanitizeReplyForChat(reply);
  const mentionsJson = options?.mentionsJson ?? [];
  const legacyMentions = mentionsJson.map((mention) => mention.id);
  const artifacts: MessageArtifact[] = [];
  const createdTaskIds: string[] = [];
  const createdMemoryIds: string[] = [];
  const createdApprovalIds: string[] = [];
  const createdArtifactIds: string[] = [];

  const validatedCitations =
    options?.fileContext && effect.citations?.length
      ? validateCitations(effect.citations, options.fileContext)
      : [];

  for (const citation of validatedCitations) {
    artifacts.push({
      type: "file",
      id: citation.chunkId,
      label: citation.label,
      meta: {
        fileId: citation.fileId,
        chunkId: citation.chunkId,
        fileName: citation.fileName,
        locator: citation.locator,
        quote: citation.quote,
        fileStatus: "ready",
      },
    });
  }

  for (const draft of effect.artifacts ?? []) {
    const artifactId = uid("art");
    const sourceFileIds = [...new Set(draft.sourceFileIds ?? [])];
    const sourceChunkIds = [...new Set(draft.sourceChunkIds ?? [])];
    const sourceCitations = (draft.sourceCitations ?? validatedCitations).map((item) => ({
      fileId: item.fileId,
      chunkId: item.chunkId,
      label: item.label,
      quote: item.quote ?? null,
      fileName: (item as FileCitationEffect & { fileName?: string }).fileName ?? null,
      locator: (item as FileCitationEffect & { locator?: string }).locator ?? null,
    }));
    const contentJson = draft.contentJson ?? {};

    const { error: artifactError } = await client.from("artifacts").insert({
      workspace_id: workspaceId,
      id: artifactId,
      room_id: roomId,
      topic_id: topicId,
      title: draft.title,
      artifact_type: draft.artifactType,
      status: draft.status ?? "draft",
      content_markdown: draft.contentMarkdown,
      content_json: contentJson,
      created_by_type: "ai",
      created_by_id: employee.id,
      source_file_ids: sourceFileIds,
      source_message_ids: triggerMessageId ? [triggerMessageId] : [],
      source_chunk_ids: sourceChunkIds,
      source_citations: sourceCitations,
    });
    if (artifactError) throw artifactError;

    await syncArtifactToStorage(
      client,
      {
        id: artifactId,
        workspaceId,
        title: draft.title,
        contentMarkdown: draft.contentMarkdown,
        metadata: {},
        driveFolderId: null,
      },
      employee.id,
    ).catch((err) => console.warn("[AdeHQ room-messages] artifact storage sync failed", err));

    await client.from("artifact_versions").insert({
      artifact_id: artifactId,
      version_number: 1,
      content_markdown: draft.contentMarkdown,
      content_json: contentJson,
      source_citations: sourceCitations,
      created_by_type: "ai",
      created_by_id: employee.id,
    });

    createdArtifactIds.push(artifactId);
    const emailJson =
      draft.artifactType === "email_draft"
        ? (contentJson as EmailDraftJson)
        : undefined;
    artifacts.push({
      type: "artifact",
      id: artifactId,
      label: draft.title,
      meta: {
        artifactType: draft.artifactType,
        artifactStatus: draft.status ?? "draft",
        createdByName: employee.name,
        sourceCount: sourceFileIds.length + sourceChunkIds.length,
        subject: emailJson?.subject,
        body: emailJson?.body,
        recipient: emailJson?.recipientName ?? undefined,
        company: emailJson?.recipientOrganization ?? undefined,
      },
    });

    await insertWorkGraphEdge(client, {
      workspaceId,
      fromObjectType: "artifact",
      fromObjectId: artifactId,
      relationType: "created_from_message",
      toObjectType: "message",
      toObjectId: triggerMessageId ?? "",
    }).catch(() => undefined);

    for (const fileId of sourceFileIds) {
      await insertWorkGraphEdge(client, {
        workspaceId,
        fromObjectType: "artifact",
        fromObjectId: artifactId,
        relationType: "sources_file",
        toObjectType: "file",
        toObjectId: fileId,
      }).catch(() => undefined);
    }

    const action = artifactWorkLogAction(draft.artifactType);
    const logSummary =
      draft.artifactType === "email_draft"
        ? `Drafted ${draft.title}`
        : `Generated ${draft.artifactType.replace(/_/g, " ")}: ${draft.title}`;
    const { error: artifactLogError } = await client.from("work_log_events").insert({
      workspace_id: workspaceId,
      id: uid("wl"),
      room_id: roomId,
      topic_id: topicId,
      employee_id: employee.id,
      action,
      summary: logSummary,
      status: "success",
      related_entity_type: "artifact",
      related_entity_id: artifactId,
      agent_run_id: agentRunId ?? null,
      created_at: nowISO(),
    });
    if (artifactLogError) throw artifactLogError;
  }

  for (const [index, suggestion] of (effect.memorySuggestions ?? []).entries()) {
    const suggestionKey = uid("mem-sug");
    artifacts.push({
      type: "memory_suggestion",
      id: suggestionKey,
      label: `Save to memory: ${suggestion.text.slice(0, 56)}${suggestion.text.length > 56 ? "…" : ""}`,
      meta: {
        memoryText: suggestion.text,
        reason: suggestion.reason,
        sourceFileId: suggestion.sourceFileId,
        sourceChunkId: suggestion.sourceChunkId,
        sourceArtifactId: suggestion.sourceArtifactId,
        suggestionKey,
        suggestionIndex: index,
      },
    });
  }

  if (options?.usedFileContext && !(effect.artifacts ?? []).length) {
    const hasFileWorkLog = effect.workLog.some((entry) =>
      ["answered_question_about_file", "generated_artifact"].includes(
        String(entry.action ?? "").toLowerCase(),
      ),
    );
    if (!hasFileWorkLog) {
      effect.workLog.push({
        action: "answered_question_about_file",
        summary: "Answered using uploaded file context",
        status: "success",
        relatedEntityType: "file",
      });
    }
  }

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
      room_id: roomId,
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
      room_id: roomId,
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
    if ((effect.artifacts ?? []).some((a) => a.artifactType === "email_draft")) continue;
    const raw = `Subject: ${draft.subject}\n\n${draft.body}`;
    const extracted =
      extractArtifactFromMessage(raw, { preferredType: "email_draft" }) ??
      ({
        artifactType: "email_draft" as const,
        title: draft.company ? `${draft.company} outreach email` : draft.subject.slice(0, 72),
        contentMarkdown: emailMarkdownFromJson(buildEmailDraftJson(raw)),
        contentJson: buildEmailDraftJson(raw) as unknown as Record<string, unknown>,
      });
    const json = extracted.contentJson as unknown as EmailDraftJson;
    const artifactId = uid("art");
    await client.from("artifacts").insert({
      workspace_id: workspaceId,
      id: artifactId,
      room_id: roomId,
      topic_id: topicId,
      title: extracted.title,
      artifact_type: "email_draft",
      status: "draft",
      content_markdown: extracted.contentMarkdown,
      content_json: extracted.contentJson,
      created_by_type: "ai",
      created_by_id: employee.id,
      source_file_ids: [],
      source_message_ids: triggerMessageId ? [triggerMessageId] : [],
      source_chunk_ids: [],
      source_citations: [],
    });
    await syncArtifactToStorage(
      client,
      {
        id: artifactId,
        workspaceId,
        title: extracted.title,
        contentMarkdown: extracted.contentMarkdown,
        metadata: {},
        driveFolderId: null,
      },
      employee.id,
    ).catch((err) => console.warn("[AdeHQ room-messages] email artifact storage sync failed", err));
    await client.from("artifact_versions").insert({
      artifact_id: artifactId,
      version_number: 1,
      content_markdown: extracted.contentMarkdown,
      content_json: extracted.contentJson,
      source_citations: [],
      created_by_type: "ai",
      created_by_id: employee.id,
    });
    createdArtifactIds.push(artifactId);
    artifacts.push({
      type: "artifact",
      id: artifactId,
      label: extracted.title,
      meta: {
        artifactType: "email_draft",
        artifactStatus: "draft",
        createdByName: employee.name,
        subject: json.subject,
        body: json.body,
        recipient: draft.recipient,
        company: draft.company,
      },
    });
    await client.from("work_log_events").insert({
      workspace_id: workspaceId,
      id: uid("wl"),
      room_id: roomId,
      topic_id: topicId,
      employee_id: employee.id,
      action: "created_email_draft",
      summary: `Drafted ${extracted.title}`,
      status: "success",
      related_entity_type: "artifact",
      related_entity_id: artifactId,
      agent_run_id: agentRunId ?? null,
      created_at: nowISO(),
    });
  }

  // Integration tool calls — the Tool Execution Core runs each call through
  // grant checks, the preview/approval gate, tool runs, and work logs, and
  // returns chat chips (approval cards, created records) for this message.
  if (effect.toolCalls?.length) {
    try {
      const toolOutcome = await executeEmployeeToolCalls(client, {
        workspaceId,
        employee,
        roomId,
        topicId,
        agentRunId,
        triggerMessageId,
        toolCalls: effect.toolCalls,
      });
      artifacts.push(...toolOutcome.messageArtifacts);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      console.error("[AdeHQ room-messages] tool call execution failed", error);
      artifacts.push({
        type: "tool_result",
        id: `tool-err-${triggerMessageId ?? uid("tr")}`,
        label: "Could not complete requested actions",
        meta: {
          toolStatus: "failed",
          error: message,
          subtitle: message,
        },
      });
    }
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
      room_id: roomId,
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
      room_id: roomId,
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

  const aiMessage: RoomMessage = {
    id: uid("msg"),
    roomId,
    topicId,
    senderType: "ai",
    senderId: employee.id,
    senderName: employee.name,
    content: reply,
    mentions: legacyMentions.length ? legacyMentions : undefined,
    mentionsJson: mentionsJson.length ? mentionsJson : undefined,
    artifacts: artifacts.length ? artifacts : undefined,
    createdAt: nowISO(),
  };

  const { error: messageError } = await client.from("messages").insert({
    workspace_id: workspaceId,
    id: aiMessage.id,
    room_id: roomId,
    topic_id: topicId,
    sender_type: aiMessage.senderType,
    sender_id: aiMessage.senderId,
    sender_name: aiMessage.senderName,
    content: aiMessage.content,
    mentions: legacyMentions,
    mentions_json: mentionsJson,
    artifacts: aiMessage.artifacts ?? null,
    agent_run_id: agentRunId ?? null,
    trigger_message_id: triggerMessageId ?? null,
    pending: false,
    created_at: aiMessage.createdAt,
  });
  if (messageError) throw messageError;

  await recordAiMessageInTopicOrchestrationState(client, {
    workspaceId,
    roomId,
    topicId,
    employeeId: employee.id,
    messageId: aiMessage.id,
    content: aiMessage.content,
    createdAt: aiMessage.createdAt,
  });

  for (const artifactId of createdArtifactIds) {
    await client.from("message_attachments").insert({
      workspace_id: workspaceId,
      message_id: aiMessage.id,
      artifact_id: artifactId,
      attachment_type: "artifact",
    });
  }

  if (triggerMessageId && (options?.usedFileContext || validatedCitations.length)) {
    await insertWorkGraphEdge(client, {
      workspaceId,
      fromObjectType: "message",
      fromObjectId: aiMessage.id,
      relationType: "answers_with_files",
      toObjectType: "message",
      toObjectId: triggerMessageId,
    }).catch(() => undefined);
  }

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
    .from("rooms")
    .select("workspace_id")
    .eq("id", roomId)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.workspace_id ? String(data[0].workspace_id) : null;
}
