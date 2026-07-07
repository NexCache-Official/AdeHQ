import type { PlatformAdminRole } from "./types";

export type PlatformPermission =
  | "overview.read"
  | "growth.read"
  | "users.read"
  | "users.write"
  | "workspaces.read"
  | "workspaces.write"
  | "usage.read"
  | "work_hours.read"
  | "models.read"
  | "models.write"
  | "provider_credentials.read"
  | "provider_credentials.write"
  | "browser_research.read"
  | "flags.read"
  | "flags.write"
  | "maintenance.write"
  | "incidents.write"
  | "plans.read"
  | "plans.write"
  | "billing.read"
  | "billing.write"
  | "support.read"
  | "restricted_access.request"
  | "audit.read";

const PLATFORM_ADMIN_PERMISSIONS: Record<PlatformAdminRole, PlatformPermission[] | ["*"]> = {
  super_admin: ["*"],
  ops_admin: [
    "overview.read",
    "growth.read",
    "users.read",
    "workspaces.read",
    "usage.read",
    "work_hours.read",
    "models.read",
    "models.write",
    "provider_credentials.read",
    "provider_credentials.write",
    "browser_research.read",
    "flags.read",
    "flags.write",
    "maintenance.write",
    "incidents.write",
    "audit.read",
  ],
  support_admin: [
    "users.read",
    "workspaces.read",
    "support.read",
    "restricted_access.request",
    "audit.read",
  ],
  billing_admin: [
    "billing.read",
    "billing.write",
    "plans.read",
    "plans.write",
    "usage.read",
  ],
  readonly_admin: [
    "overview.read",
    "growth.read",
    "users.read",
    "workspaces.read",
    "usage.read",
    "work_hours.read",
    "models.read",
    "provider_credentials.read",
    "browser_research.read",
    "flags.read",
    "audit.read",
  ],
};

export function permissionsForRole(role: PlatformAdminRole): PlatformPermission[] {
  const perms = PLATFORM_ADMIN_PERMISSIONS[role];
  if (perms[0] === "*") {
    const all = new Set<PlatformPermission>();
    for (const entry of Object.values(PLATFORM_ADMIN_PERMISSIONS)) {
      if (entry[0] === "*") continue;
      for (const p of entry as PlatformPermission[]) all.add(p);
    }
    return [...all];
  }
  return perms as PlatformPermission[];
}

export function hasPlatformPermission(
  role: PlatformAdminRole,
  permission: PlatformPermission,
): boolean {
  const perms = PLATFORM_ADMIN_PERMISSIONS[role];
  if (perms[0] === "*") return true;
  return (perms as PlatformPermission[]).includes(permission);
}

export function assertPlatformPermission(
  role: PlatformAdminRole,
  permission: PlatformPermission,
): void {
  if (!hasPlatformPermission(role, permission)) {
    throw new Error(`Missing platform permission: ${permission}`);
  }
}
