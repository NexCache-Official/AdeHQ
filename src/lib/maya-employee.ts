import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";
import {
  MAYA_EMPLOYEE_ID,
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_ROLE_KEY,
  MAYA_EMPLOYEE_SYSTEM_PROMPT,
  MAYA_EMPLOYEE_TITLE,
  MAYA_SYSTEM_EMPLOYEE_KEY,
} from "@/lib/hiring/maya";
import type { AIEmployee, EmployeePermissions, ProjectRoom } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";

export type SystemEmployeeMetadata = {
  dmOnly?: boolean;
  canBeArchived?: boolean;
  canBeAssignedToChannels?: boolean;
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

export function partitionWorkforce(employees: AIEmployee[]) {
  const maya = employees.filter(isMayaEmployee);
  const hired = employees.filter((e) => !isSystemEmployee(e));
  return { maya, hired, all: employees };
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
    status: "idle",
    instructions: MAYA_EMPLOYEE_SYSTEM_PROMPT.trim(),
    communicationStyle: "Warm, sharp, practical, and efficient",
    successCriteria: "Help users hire and improve AI employees quickly",
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
      purpose: "hire_and_manage_ai_employees",
    },
  };
}

export function buildMayaDmRoom(userId: string, welcomeContent: string): ProjectRoom {
  const id = `dm-${MAYA_EMPLOYEE_ID}`;
  const timestamp = nowISO();
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

export function mergeMayaIntoState<T extends { employees: AIEmployee[]; rooms: ProjectRoom[] }>(
  state: T,
  userId?: string,
  welcomeContent?: string,
): T {
  if (state.employees.some(isMayaEmployee)) {
    return state;
  }
  const maya = buildMayaEmployee();
  const next: T = {
    ...state,
    employees: [maya, ...state.employees],
  };
  if (!userId || !welcomeContent) return next;

  const existingDm = state.rooms.find(
    (r) => r.kind === "dm" && r.dmEmployeeId === MAYA_EMPLOYEE_ID,
  );
  if (existingDm) return next;

  return {
    ...next,
    rooms: [buildMayaDmRoom(userId, welcomeContent), ...state.rooms],
  };
}
