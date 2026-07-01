import { isMayaEmployee, isSystemEmployee } from "@/lib/maya-employee";
import type { AIEmployee } from "@/lib/types";
import type { AIEmployeeProfile, EmployeeCollaborationPermissions } from "./types";

export const DEFAULT_EMPLOYEE_COLLABORATION_PERMISSIONS: EmployeeCollaborationPermissions =
  {
    canReplyInRooms: true,
    canJoinTopics: true,
    canSuggestTopics: true,
    canCreateTopics: false,
    canMoveMessages: false,
    canInviteEmployees: false,
    requiresApprovalForTopicChanges: true,
  };

export const MAYA_COLLABORATION_PERMISSIONS: EmployeeCollaborationPermissions = {
  canReplyInRooms: false,
  canJoinTopics: false,
  canSuggestTopics: false,
  canCreateTopics: false,
  canMoveMessages: false,
  canInviteEmployees: false,
  requiresApprovalForTopicChanges: true,
};

export function collaborationPermissionsForEmployee(
  employee: Pick<AIEmployee, "metadata" | "systemEmployeeKey" | "id" | "isSystemEmployee">,
): EmployeeCollaborationPermissions {
  if (isMayaEmployee(employee)) return MAYA_COLLABORATION_PERMISSIONS;
  const raw = employee.metadata?.collaborationPermissions;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...DEFAULT_EMPLOYEE_COLLABORATION_PERMISSIONS, ...(raw as EmployeeCollaborationPermissions) };
  }
  if (isSystemEmployee(employee)) return MAYA_COLLABORATION_PERMISSIONS;
  return DEFAULT_EMPLOYEE_COLLABORATION_PERMISSIONS;
}

export function filterOrchestrationEmployees<T extends AIEmployeeProfile>(
  employees: T[],
): T[] {
  return employees.filter((employee) => {
    if (isMayaEmployee(employee)) return false;
    const perms = collaborationPermissionsForEmployee(employee);
    return perms.canReplyInRooms;
  });
}
