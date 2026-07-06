import type { WorkspaceMemberRole } from "@/lib/types";

/**
 * Workspace role permission matrix (customer plane).
 * This is distinct from platform admin permissions (src/lib/admin/permissions.ts).
 *
 * Role behavior (v1):
 *   owner   — full control incl. billing, plan change, delete workspace, manage admins
 *   admin   — manage members/roles/AI employees/settings, billing + checkout
 *   manager — manage rooms/topics/AI employees/tasks, view usage; no billing
 *   member  — participate + use AI within workspace limits
 *   guest   — limited room/topic access
 */

export const WORKSPACE_ROLES: WorkspaceMemberRole[] = [
  "owner",
  "admin",
  "manager",
  "member",
  "guest",
];

function normalizeRole(role: string | null | undefined): WorkspaceMemberRole {
  switch (role) {
    case "owner":
    case "admin":
    case "manager":
    case "member":
    case "guest":
      return role;
    case "viewer":
      return "guest";
    default:
      return "member";
  }
}

const OWNER_ADMIN = new Set<WorkspaceMemberRole>(["owner", "admin"]);
const OWNER_ADMIN_MANAGER = new Set<WorkspaceMemberRole>(["owner", "admin", "manager"]);

// Billing + commercial controls — owner and admin only.
export function canViewBilling(role: string | null | undefined): boolean {
  return OWNER_ADMIN.has(normalizeRole(role));
}

export function canStartCheckout(role: string | null | undefined): boolean {
  return OWNER_ADMIN.has(normalizeRole(role));
}

export function canApplyPromoCode(role: string | null | undefined): boolean {
  return OWNER_ADMIN.has(normalizeRole(role));
}

export function canChangePlan(role: string | null | undefined): boolean {
  return OWNER_ADMIN.has(normalizeRole(role));
}

// Usage visibility — owner, admin, manager.
export function canViewUsage(role: string | null | undefined): boolean {
  return OWNER_ADMIN_MANAGER.has(normalizeRole(role));
}

// Member + workspace management.
export function canManageMembers(role: string | null | undefined): boolean {
  return OWNER_ADMIN.has(normalizeRole(role));
}

export function canManageAiEmployees(role: string | null | undefined): boolean {
  return OWNER_ADMIN_MANAGER.has(normalizeRole(role));
}

export function canManageWorkspaceSettings(role: string | null | undefined): boolean {
  return OWNER_ADMIN.has(normalizeRole(role));
}

export function canDeleteWorkspace(role: string | null | undefined): boolean {
  return normalizeRole(role) === "owner";
}

export function canParticipate(role: string | null | undefined): boolean {
  // All active roles can participate in workspace collaboration.
  return WORKSPACE_ROLES.includes(normalizeRole(role));
}

/** Roles a workspace admin may assign via the members UI (never owner). */
export function assignableRoles(): WorkspaceMemberRole[] {
  return ["admin", "manager", "member", "guest"];
}

export { normalizeRole as normalizeWorkspaceRole };
