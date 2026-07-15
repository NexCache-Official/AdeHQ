import type { SupabaseClient } from "@supabase/supabase-js";

export class AccountLifecycleError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AccountLifecycleError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: string;
};

export type AccountDeletionContext = {
  userId: string;
  email: string;
  ownedWorkspaces: WorkspaceSummary[];
  memberWorkspaces: WorkspaceSummary[];
  canDeleteAccountAlone: boolean;
  requiresWorkspaceDeletionFirst: boolean;
};

type DbRow = Record<string, unknown>;

export async function getAccountDeletionContext(
  client: SupabaseClient,
  userId: string,
  email: string,
): Promise<AccountDeletionContext> {
  const { data: ownedRows, error: ownedError } = await client
    .from("workspaces")
    .select("id, name")
    .eq("owner_id", userId);

  if (ownedError) throw ownedError;

  const { data: memberRows, error: memberError } = await client
    .from("workspace_members")
    .select("role, workspace_id, workspaces ( id, name, owner_id )")
    .eq("user_id", userId)
    .eq("status", "active");

  if (memberError) throw memberError;

  const ownedIds = new Set((ownedRows ?? []).map((r) => String(r.id)));

  const ownedWorkspaces: WorkspaceSummary[] = (ownedRows ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: "admin",
  }));

  const memberWorkspaces: WorkspaceSummary[] = (memberRows ?? [])
    .map((row) => {
      const joined = row.workspaces as
        | { id: string; name: string; owner_id: string }
        | { id: string; name: string; owner_id: string }[]
        | null;
      const ws = Array.isArray(joined) ? joined[0] : joined;
      if (!ws || ownedIds.has(ws.id)) return null;
      return {
        id: ws.id,
        name: ws.name,
        role: String(row.role),
      } satisfies WorkspaceSummary;
    })
    .filter((row): row is WorkspaceSummary => row !== null);

  const ownedCount = ownedWorkspaces.length;

  return {
    userId,
    email,
    ownedWorkspaces,
    memberWorkspaces,
    canDeleteAccountAlone: ownedCount === 0,
    requiresWorkspaceDeletionFirst: ownedCount > 0,
  };
}

export async function assertWorkspaceOwner(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, name, owner_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new AccountLifecycleError("workspace_not_found", "Workspace not found.", 404);
  }

  if (String(data.owner_id) !== userId) {
    throw new AccountLifecycleError(
      "not_workspace_owner",
      "Only the workspace owner can delete this workspace.",
      403,
    );
  }

  return { id: String(data.id), name: String(data.name) };
}

/** Permanently deletes a workspace and all cascaded data. */
export async function purgeWorkspace(
  serviceClient: SupabaseClient,
  workspaceId: string,
  userId: string,
  confirmName: string,
): Promise<{ deletedWorkspaceId: string; remainingWorkspaceIds: string[] }> {
  const workspace = await assertWorkspaceOwner(serviceClient, workspaceId, userId);

  if (confirmName.trim() !== workspace.name.trim()) {
    throw new AccountLifecycleError(
      "confirm_name_mismatch",
      "Workspace name does not match. Deletion cancelled.",
      400,
    );
  }

  const { error } = await serviceClient.from("workspaces").delete().eq("id", workspaceId);
  if (error) {
    throw new AccountLifecycleError(
      "workspace_delete_failed",
      error.message ?? "Could not delete workspace.",
      500,
    );
  }

  const { data: remaining, error: remainingError } = await serviceClient
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("status", "active");

  if (remainingError) throw remainingError;

  return {
    deletedWorkspaceId: workspaceId,
    remainingWorkspaceIds: (remaining ?? []).map((r) => String(r.workspace_id)),
  };
}

/** Deletes owned workspaces (optional) then removes the auth user and profile. */
export async function purgeUserAccount(
  serviceClient: SupabaseClient,
  userId: string,
  email: string,
  options: {
    confirmEmail: string;
    deleteOwnedWorkspaces?: boolean;
  },
): Promise<{ deletedWorkspaceIds: string[] }> {
  if (options.confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new AccountLifecycleError(
      "confirm_email_mismatch",
      "Email confirmation does not match your account.",
      400,
    );
  }

  const ctx = await getAccountDeletionContext(serviceClient, userId, email);
  const deletedWorkspaceIds: string[] = [];

  if (ctx.ownedWorkspaces.length > 0 && !options.deleteOwnedWorkspaces) {
    throw new AccountLifecycleError(
      "owned_workspaces_block_account_delete",
      "You own a workspace. Delete the workspace first, or delete your workspace and account together.",
      400,
      {
        ownedWorkspaces: ctx.ownedWorkspaces,
      },
    );
  }

  if (ctx.ownedWorkspaces.length > 0 && options.deleteOwnedWorkspaces) {
    for (const ws of ctx.ownedWorkspaces) {
      const { error } = await serviceClient.from("workspaces").delete().eq("id", ws.id);
      if (error) {
        throw new AccountLifecycleError(
          "workspace_delete_failed",
          `Could not delete workspace "${ws.name}".`,
          500,
          { workspaceId: ws.id },
        );
      }
      deletedWorkspaceIds.push(ws.id);
    }
  }

  const { error: signOutError } = await serviceClient.auth.admin.signOut(userId, "global");
  if (signOutError) {
    console.warn("[AdeHQ] global sign-out before account delete:", signOutError.message);
  }

  const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    throw new AccountLifecycleError(
      "account_delete_failed",
      deleteError.message ?? "Could not delete account.",
      500,
    );
  }

  return { deletedWorkspaceIds };
}
