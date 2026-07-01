import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import {
  MAYA_EMPLOYEE_ID,
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_ROLE_KEY,
  MAYA_EMPLOYEE_SYSTEM_PROMPT,
  MAYA_EMPLOYEE_TITLE,
  MAYA_SYSTEM_EMPLOYEE_KEY,
} from "@/lib/hiring/maya";
import type { AIEmployee, EmployeePermissions, ProjectRoom, RoomTopic, TopicMember } from "@/lib/types";
import { isGeneralTopic } from "@/lib/topics";
import { nowISO, uid } from "@/lib/utils";

export type SystemEmployeeMetadata = {
  dmOnly?: boolean;
  canBeArchived?: boolean;
  canBeAssignedToChannels?: boolean;
  isDefaultWorkspaceEmployee?: boolean;
  purpose?: string;
};

const MAYA_PERMISSIONS: EmployeePermissions = {
  readMemory: true,
  writeDraftMemory: true,
  pinMemory: false,
  createTasks: true,
  assignTasks: false,
  messageEmployees: true,
  startCalls: false,
  requestApproval: true,
  approvalBeforeExternal: true,
  approvalBeforeEmails: true,
  approvalBeforeCode: false,
  approvalBeforeBilling: true,
};

export function isMayaEmployee(employee: Pick<AIEmployee, "id" | "systemEmployeeKey">): boolean {
  return (
    employee.id === MAYA_EMPLOYEE_ID ||
    employee.systemEmployeeKey === MAYA_SYSTEM_EMPLOYEE_KEY
  );
}

export function isSystemEmployee(
  employee: Pick<AIEmployee, "isSystemEmployee" | "systemEmployeeKey">,
): boolean {
  return Boolean(employee.isSystemEmployee || employee.systemEmployeeKey);
}

export function mayaEmployeeStatus(): AIEmployee["status"] {
  return "online";
}

export function effectiveEmployeeStatus(
  employee: Pick<AIEmployee, "status" | "systemEmployeeKey" | "id">,
): AIEmployee["status"] {
  return isMayaEmployee(employee) ? mayaEmployeeStatus() : employee.status;
}

export function channelAssignableEmployees(employees: AIEmployee[]): AIEmployee[] {
  return employees.filter((employee) => {
    if (isMayaEmployee(employee)) return false;
    if (isSystemEmployee(employee)) return false;
    if (employee.metadata?.canBeAssignedToChannels === false) return false;
    if (employee.metadata?.dmOnly) return false;
    return true;
  });
}

export function mergeEmployeesById(local: AIEmployee[], remote: AIEmployee[]): AIEmployee[] {
  const merged = new Map(remote.map((employee) => [employee.id, employee]));
  for (const employee of local) {
    if (!merged.has(employee.id)) merged.set(employee.id, employee);
  }
  return Array.from(merged.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function partitionWorkforce(employees: AIEmployee[]) {
  const maya = employees.filter(isMayaEmployee);
  const hired = employees.filter((e) => !isSystemEmployee(e));
  return { maya, hired, all: employees };
}

export function mayaDmRoomId(): string {
  return `dm-${MAYA_EMPLOYEE_ID}`;
}

export function findMayaDmRoom(rooms: Pick<ProjectRoom, "id" | "kind" | "dmEmployeeId">[]): ProjectRoom | undefined {
  return rooms.find((room) => room.kind === "dm" && room.dmEmployeeId === MAYA_EMPLOYEE_ID) as
    | ProjectRoom
    | undefined;
}

export function resolveMayaDmRoomId(rooms: Pick<ProjectRoom, "id" | "kind" | "dmEmployeeId">[]): string {
  return findMayaDmRoom(rooms)?.id ?? mayaDmRoomId();
}

export function mayaDmGeneralTopicId(roomId = mayaDmRoomId()): string {
  return `topic-general-${roomId}`;
}

export function buildMayaDmGeneralTopic(
  workspaceId: string,
  roomId: string,
  timestamp: string,
  messageCount = 1,
): RoomTopic {
  return {
    id: mayaDmGeneralTopicId(roomId),
    workspaceId,
    roomId,
    title: "General",
    description: "Default topic for existing room messages.",
    status: "active",
    priority: "normal",
    createdByType: "system",
    lastMessageAt: timestamp,
    lastActivityAt: timestamp,
    messageCount,
    taskCount: 0,
    openTaskCount: 0,
    memoryCount: 0,
    approvalCount: 0,
    agentRunCount: 0,
    metadata: { isMainChat: true, aiParticipationMode: "smart_assist_lite" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function buildMayaDmTopicMembers(
  workspaceId: string,
  roomId: string,
  topicId: string,
  userId: string,
  timestamp: string,
): TopicMember[] {
  return [
    {
      id: `tm-${roomId}-human`,
      workspaceId,
      roomId,
      topicId,
      memberType: "human",
      memberId: userId,
      role: "owner",
      notificationLevel: "normal",
      createdAt: timestamp,
    },
    {
      id: `tm-${roomId}-${MAYA_EMPLOYEE_ID}`,
      workspaceId,
      roomId,
      topicId,
      memberType: "ai",
      memberId: MAYA_EMPLOYEE_ID,
      role: "participant",
      notificationLevel: "normal",
      createdAt: timestamp,
    },
  ];
}

export function buildMayaEmployee(timestamp = nowISO()): AIEmployee {
  return {
    id: MAYA_EMPLOYEE_ID,
    name: MAYA_EMPLOYEE_NAME,
    role: MAYA_EMPLOYEE_TITLE,
    roleKey: MAYA_EMPLOYEE_ROLE_KEY,
    provider: "siliconflow",
    model: DEFAULT_SILICONFLOW_MODEL,
    modelMode: "balanced",
    seniority: "Manager",
    status: mayaEmployeeStatus(),
    instructions: MAYA_EMPLOYEE_SYSTEM_PROMPT.trim(),
    communicationStyle: "Warm, sharp, practical, and efficient",
    successCriteria:
      "Help users hire and improve AI employees quickly, and guide them through how AdeHQ works",
    tools: [],
    permissions: MAYA_PERMISSIONS,
    memoryCount: 0,
    tasksCompleted: 0,
    messagesSent: 0,
    approvalsRequested: 0,
    avgResponseTime: "-",
    trustScore: 95,
    accent: "#0ea5e9",
    participationStyle: "proactive_operator",
    lastActiveAt: timestamp,
    createdAt: timestamp,
    isSystemEmployee: true,
    systemEmployeeKey: MAYA_SYSTEM_EMPLOYEE_KEY,
    metadata: {
      dmOnly: true,
      canBeArchived: false,
      canBeAssignedToChannels: false,
      isDefaultWorkspaceEmployee: true,
      purpose: "hire_and_manage_ai_employees,workspace_guide",
    },
  };
}

export function buildMayaDmRoom(userId: string, welcomeContent: string): ProjectRoom {
  const id = mayaDmRoomId();
  const timestamp = nowISO();
  const topicId = mayaDmGeneralTopicId(id);
  return {
    id,
    name: MAYA_EMPLOYEE_NAME,
    kind: "dm",
    dmEmployeeId: MAYA_EMPLOYEE_ID,
    description: `Direct message with ${MAYA_EMPLOYEE_NAME}`,
    brief: MAYA_EMPLOYEE_SYSTEM_PROMPT.trim(),
    humans: [userId],
    aiEmployees: [MAYA_EMPLOYEE_ID],
    messages: [
      {
        id: uid("msg"),
        roomId: id,
        topicId,
        senderType: "ai",
        senderId: MAYA_EMPLOYEE_ID,
        senderName: MAYA_EMPLOYEE_NAME,
        content: welcomeContent,
        createdAt: timestamp,
      },
    ],
    tasks: [],
    memory: [],
    unread: 0,
    accent: "#0ea5e9",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function ensureMayaDmTopicsInState<
  T extends {
    employees: AIEmployee[];
    rooms: ProjectRoom[];
    topics?: RoomTopic[];
    topicMembers?: TopicMember[];
    workspace?: { id: string };
  },
>(state: T, userId?: string): T {
  const dmRoom = state.rooms.find((room) => room.kind === "dm" && room.dmEmployeeId === MAYA_EMPLOYEE_ID);
  if (!dmRoom || !userId) return state;

  const roomTopics = (state.topics ?? []).filter((topic) => topic.roomId === dmRoom.id);
  const generalTopic =
    roomTopics.find((topic) => isGeneralTopic(topic)) ??
    roomTopics.find((topic) => topic.title.toLowerCase() === "general");

  if (generalTopic) {
    const needsMessageSync = dmRoom.messages.some((message) => message.topicId !== generalTopic.id);
    if (!needsMessageSync) return state;
    return {
      ...state,
      rooms: state.rooms.map((room) =>
        room.id === dmRoom.id
          ? {
              ...room,
              messages: room.messages.map((message) =>
                message.topicId === generalTopic.id
                  ? message
                  : { ...message, topicId: generalTopic.id },
              ),
            }
          : room,
      ),
    };
  }

  // Supabase already returned topics for this room but none marked General — don't inject fake IDs.
  if (roomTopics.length > 0) return state;

  const workspaceId = state.workspace?.id ?? "local";
  const topic = buildMayaDmGeneralTopic(
    workspaceId,
    dmRoom.id,
    dmRoom.updatedAt ?? dmRoom.createdAt,
    dmRoom.messages.length,
  );
  const topicMembers = buildMayaDmTopicMembers(
    workspaceId,
    dmRoom.id,
    topic.id,
    userId,
    dmRoom.createdAt,
  );

  return {
    ...state,
    rooms: state.rooms.map((room) =>
      room.id === dmRoom.id
        ? {
            ...room,
            messages: room.messages.map((message) =>
              message.topicId ? message : { ...message, topicId: topic.id },
            ),
          }
        : room,
    ),
    topics: [...(state.topics ?? []), topic],
    topicMembers: [...(state.topicMembers ?? []), ...topicMembers],
  };
}

export function dedupeMayaDmRooms<T extends { rooms: ProjectRoom[] }>(state: T): T {
  const canonicalId = mayaDmRoomId();
  const mayaRooms = state.rooms.filter(
    (room) => room.kind === "dm" && room.dmEmployeeId === MAYA_EMPLOYEE_ID,
  );
  if (mayaRooms.length <= 1) return state;

  const canonical =
    mayaRooms.find((room) => room.id === canonicalId) ??
    mayaRooms.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const duplicateIds = new Set(
    mayaRooms.filter((room) => room.id !== canonical.id).map((room) => room.id),
  );

  return {
    ...state,
    rooms: state.rooms.filter((room) => !duplicateIds.has(room.id)),
  };
}

export function mergeMayaIntoState<
  T extends {
    employees: AIEmployee[];
    rooms: ProjectRoom[];
    topics?: RoomTopic[];
    topicMembers?: TopicMember[];
    workspace?: { id: string };
  },
>(state: T, userId?: string, welcomeContent?: string): T {
  let next = state;

  if (!state.employees.some(isMayaEmployee)) {
    const maya = buildMayaEmployee();
    next = {
      ...next,
      employees: [maya, ...state.employees],
    };
  } else {
    next = {
      ...next,
      employees: state.employees.map((employee) =>
        isMayaEmployee(employee)
          ? {
              ...buildMayaEmployee(employee.createdAt),
              lastActiveAt: employee.lastActiveAt,
              memoryCount: employee.memoryCount,
              tasksCompleted: employee.tasksCompleted,
              messagesSent: employee.messagesSent,
              approvalsRequested: employee.approvalsRequested,
            }
          : employee,
      ),
    };
  }

  if (userId && welcomeContent) {
    next = dedupeMayaDmRooms(next);
    const existingDm = next.rooms.find(
      (room) => room.kind === "dm" && room.dmEmployeeId === MAYA_EMPLOYEE_ID,
    );
    if (!existingDm) {
      next = {
        ...next,
        rooms: [buildMayaDmRoom(userId, welcomeContent), ...next.rooms],
      };
    }
  }

  return ensureMayaDmTopicsInState(next, userId);
}
