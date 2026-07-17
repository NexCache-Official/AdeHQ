import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { requireHireAdmin } from "@/lib/server/require-hire-admin";

export type HiringWorkspaceContextInput = {
  workspaceId?: string | null;
  hiringSessionId?: string | null;
  topicId?: string | null;
  mayaRoomId?: string | null;
};

export type ResolvedHiringWorkspaceContext = {
  workspaceId?: string;
  hiringSessionId?: string;
};

async function tryValidateWorkspace(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<string | undefined> {
  try {
    await requireWorkspaceMembership(client, workspaceId, userId);
    return workspaceId;
  } catch {
    return undefined;
  }
}

/**
 * Resolve and validate workspace context for hiring runtime work units.
 * Never throws — returns empty context when validation fails so hiring continues.
 */
export async function resolveHiringWorkspaceContext(
  client: SupabaseClient,
  userId: string,
  input: HiringWorkspaceContextInput,
): Promise<ResolvedHiringWorkspaceContext> {
  const sessionId = input.hiringSessionId?.trim();

  if (sessionId) {
    const { data, error } = await client
      .from("hiring_sessions")
      .select("id, workspace_id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (!error && data && String(data.user_id) === userId) {
      const workspaceId = await tryValidateWorkspace(client, String(data.workspace_id), userId);
      if (workspaceId) {
        return { workspaceId, hiringSessionId: String(data.id) };
      }
    }
  }

  const explicitWorkspaceId = input.workspaceId?.trim();
  if (explicitWorkspaceId) {
    const workspaceId = await tryValidateWorkspace(client, explicitWorkspaceId, userId);
    if (workspaceId) {
      return { workspaceId, hiringSessionId: sessionId || undefined };
    }
  }

  const topicId = input.topicId?.trim();
  if (topicId) {
    const { data, error } = await client
      .from("topics")
      .select("workspace_id")
      .eq("id", topicId)
      .maybeSingle();

    if (!error && data?.workspace_id) {
      const workspaceId = await tryValidateWorkspace(client, String(data.workspace_id), userId);
      if (workspaceId) {
        return { workspaceId, hiringSessionId: sessionId || undefined };
      }
    }
  }

  const mayaRoomId = input.mayaRoomId?.trim();
  if (mayaRoomId) {
    const { data, error } = await client
      .from("rooms")
      .select("workspace_id")
      .eq("id", mayaRoomId)
      .maybeSingle();

    if (!error && data?.workspace_id) {
      const workspaceId = await tryValidateWorkspace(client, String(data.workspace_id), userId);
      if (workspaceId) {
        return { workspaceId, hiringSessionId: sessionId || undefined };
      }
    }
  }

  return {};
}

/** Resolve hiring context and require workspace admin (hire / manage AI). */
export async function resolveHiringWorkspaceContextForAdmin(
  client: SupabaseClient,
  userId: string,
  input: HiringWorkspaceContextInput,
): Promise<ResolvedHiringWorkspaceContext & { workspaceId: string }> {
  const ctx = await resolveHiringWorkspaceContext(client, userId, input);
  if (!ctx.workspaceId) {
    throw new AuthError("Workspace context required for hiring.", 400);
  }
  await requireHireAdmin(client, ctx.workspaceId, userId);
  return { ...ctx, workspaceId: ctx.workspaceId };
}
