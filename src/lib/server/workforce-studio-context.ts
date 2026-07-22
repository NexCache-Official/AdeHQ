import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { requireHireAdmin } from "@/lib/server/require-hire-admin";
import {
  BlueprintLockConflictError,
  BlueprintNotFoundError,
  BlueprintRevisionConflictError,
} from "@/lib/hiring/workforce-studio/blueprint-service";

/** Shared auth boilerplate for every Workforce Studio route: verify the
 * bearer token, resolve + validate workspace membership, and require admin
 * (only admins can design/approve/provision a team). */
export async function requireWorkforceStudioAdmin(
  request: NextRequest,
  workspaceId: string | null | undefined,
) {
  const { user, client } = await requireAuthUser(request);
  const trimmed = workspaceId?.trim();
  if (!trimmed) throw new AuthError("workspaceId is required.", 400);
  await requireWorkspaceMembership(client, trimmed, user.id);
  await requireHireAdmin(client, trimmed, user.id);
  return { user, client, workspaceId: trimmed };
}

/** Uniform error → HTTP response mapping for every Workforce Studio route. */
export function workforceStudioErrorResponse(error: unknown, routeLabel: string): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof BlueprintNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof BlueprintLockConflictError) {
    return NextResponse.json(
      { error: error.message, code: "lock_conflict", lockedByUserId: error.lockedByUserId },
      { status: 409 },
    );
  }
  if (error instanceof BlueprintRevisionConflictError) {
    return NextResponse.json(
      { error: error.message, code: "revision_conflict", currentRevision: error.currentRevision },
      { status: 409 },
    );
  }
  console.error(`[workforce-studio${routeLabel}]`, error);
  return NextResponse.json({ error: "Workforce Studio request failed." }, { status: 500 });
}
