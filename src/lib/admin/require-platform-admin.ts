import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { PlatformPermission } from "./permissions";
import { hasPlatformPermission, permissionsForRole } from "./permissions";
import type { PlatformAdmin, PlatformAdminRole } from "./types";

export type PlatformAdminContext = {
  user: User;
  admin: PlatformAdmin;
  permissions: PlatformPermission[];
  serviceClient: SupabaseClient;
};

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function rowToAdmin(row: {
  user_id: string;
  email: string;
  role: string;
  enabled: boolean;
}): PlatformAdmin {
  const role = row.role as PlatformAdminRole;
  return {
    userId: row.user_id,
    email: row.email,
    role,
    enabled: row.enabled,
    permissions: permissionsForRole(role),
  };
}

async function maybeBootstrapSuperAdmin(
  serviceClient: SupabaseClient,
  user: User,
): Promise<PlatformAdmin | null> {
  const bootstrapEmail = normalizeEmail(process.env.PLATFORM_SUPER_ADMIN_EMAIL);
  if (!bootstrapEmail || normalizeEmail(user.email) !== bootstrapEmail) {
    return null;
  }

  const { data, error } = await serviceClient
    .from("platform_admins")
    .upsert(
      {
        user_id: user.id,
        email: user.email ?? bootstrapEmail,
        role: "super_admin",
        enabled: true,
      },
      { onConflict: "user_id" },
    )
    .select("user_id, email, role, enabled")
    .single();

  if (error || !data) return null;
  return rowToAdmin(data);
}

export async function requirePlatformAdmin(
  request: NextRequest,
): Promise<PlatformAdminContext> {
  const { user } = await requireAuthUser(request);
  const serviceClient = createServiceRoleClient();

  const { data, error } = await serviceClient
    .from("platform_admins")
    .select("user_id, email, role, enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  let admin = data && data.enabled ? rowToAdmin(data) : null;
  if (!admin) {
    admin = await maybeBootstrapSuperAdmin(serviceClient, user);
  }

  if (!admin) {
    throw new AuthError("Platform admin access required.", 403);
  }

  return {
    user,
    admin,
    permissions: admin.permissions ?? permissionsForRole(admin.role),
    serviceClient,
  };
}

const WRITE_ROLES: PlatformAdminRole[] = ["super_admin", "ops_admin"];

export function assertPlatformAdminCanWrite(admin: PlatformAdmin): void {
  if (!WRITE_ROLES.includes(admin.role)) {
    throw new AuthError("This admin role is read-only.", 403);
  }
}

/** Highest-privilege operations (Vercel secrets, destructive platform actions). */
export function assertSuperAdmin(admin: PlatformAdmin): void {
  if (admin.role !== "super_admin") {
    throw new AuthError("Super admin access required.", 403);
  }
}

export function requirePlatformPermission(
  ctx: PlatformAdminContext,
  permission: PlatformPermission,
): void {
  if (!hasPlatformPermission(ctx.admin.role, permission)) {
    throw new AuthError(`Missing platform permission: ${permission}`, 403);
  }
}
