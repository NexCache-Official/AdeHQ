import type { WorkspaceMemberRole } from "@/lib/types";

/**
 * Workspace role permission matrix (customer plane).
 * Distinct from platform admin permissions (src/lib/admin/permissions.ts).
 *
 *   admin  — members, settings, billing/checkout, hire AI, delete workspace
 *   member — full product tabs (rooms, DMs, CRM, etc.); no org admin surfaces
 */

export const WORKSPACE_ROLES: WorkspaceMemberRole[] = ["admin", "member"];

/** Map legacy roles onto admin | member. */
export function normalizeWorkspaceRole(role: string | null | undefined): WorkspaceMemberRole {
  switch (role) {
    case "admin":
    case "owner":
      return "admin";
    case "member":
    case "manager":
    case "guest":
    case "viewer":
      return "member";
    default:
      return "member";
  }
}

const ADMIN = new Set<WorkspaceMemberRole>(["admin"]);

export function isWorkspaceAdmin(role: string | null | undefined): boolean {
  return ADMIN.has(normalizeWorkspaceRole(role));
}

export function canViewBilling(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canStartCheckout(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canApplyPromoCode(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canChangePlan(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canViewUsage(role: string | null | undefined): boolean {
  return WORKSPACE_ROLES.includes(normalizeWorkspaceRole(role));
}

export function canManageMembers(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

/** Hire / terminate / modify AI employees — admin only. */
export function canManageAiEmployees(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canManageWorkspaceSettings(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canDeleteWorkspace(role: string | null | undefined): boolean {
  return isWorkspaceAdmin(role);
}

export function canParticipate(role: string | null | undefined): boolean {
  return WORKSPACE_ROLES.includes(normalizeWorkspaceRole(role));
}

/** Roles a workspace admin may assign via the members UI. */
export function assignableRoles(): WorkspaceMemberRole[] {
  return ["admin", "member"];
}

export function roleLabel(role: string | null | undefined): string {
  return normalizeWorkspaceRole(role) === "admin" ? "Admin" : "Member";
}

/** @deprecated use normalizeWorkspaceRole */
export const normalizeRole = normalizeWorkspaceRole;
