import type { WorkspaceMemberRole } from "@/lib/types";

export type PrincipalType = "human" | "ai_employee" | "system_manager" | "service_account";

export type RoomVisibility = "workspace" | "restricted" | "private";

export type EmployeeAccessLevel = "workspace" | "department" | "restricted";

export type EmployeeKind = "workspace_employee" | "system_manager";

export type AccessEffect = "allow" | "deny";

export type AiEmployeeUserGrant = {
  workspaceId: string;
  userId: string;
  employeeId: string;
  accessEffect: AccessEffect;
  canDm: boolean;
  canAssignWork: boolean;
  canViewSharedOutputs: boolean;
};

export type RoomAccessInput = {
  kind: "dm" | "room" | string;
  visibility: RoomVisibility;
  dmOwnerUserId?: string | null;
  dmPeerUserId?: string | null;
  dmEmployeeId?: string | null;
  /** Explicit membership — required for restricted/private group rooms. */
  isRoomMember: boolean;
};

export type AiEmployeeAccessInput = {
  id: string;
  employeeKind: EmployeeKind;
  employeeAccess: EmployeeAccessLevel;
  /** True when this is the Maya / system manager identity. */
  isSystemManager?: boolean;
};

export type TopicAccessInput = {
  room: RoomAccessInput;
  topicDenied: boolean;
};

export type WorkspaceActor = {
  userId: string;
  role: WorkspaceMemberRole | string;
  status?: string;
};
