import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { TOOL_CATALOG } from "@/lib/demo";
import { isEmailConfirmed } from "@/lib/auth/session";
import { ensureToolCatalog } from "@/lib/server/tool-catalog";
import { AccountLifecycleError } from "@/lib/server/account-lifecycle";
import { ensureMayaForWorkspace } from "@/lib/server/ensure-maya";
import { ensureWorkspaceProviderAllocations } from "@/lib/providers/credentials/ensure-workspace-allocations";
import { sendEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/site-url";

type DbRow = Record<string, unknown>;

export type CreateWorkspaceResult = {
  workspaceId: string;
  workspaceName: string;
};

export type BootstrapWorkspaceResult = CreateWorkspaceResult & {
  created: boolean;
};

async function sendWelcomeEmail(user: User, workspaceId: string): Promise<void> {
  if (!user.email) return;
  const meta = user.user_metadata ?? {};
  const fullName = (meta.full_name as string | undefined) ?? (meta.name as string | undefined);
  const firstName = fullName?.trim().split(/\s+/)[0];
  try {
    await sendEmail({
      template: "welcome",
      to: user.email,
      userId: user.id,
      workspaceId,
      props: { firstName, ctaUrl: `${getSiteUrl()}/` },
    });
  } catch (error) {
    console.warn("[AdeHQ welcome email]", error);
  }
}

async function findExistingWorkspaceId(
  client: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: memberRows, error: memberError } = await client
    .from("workspace_members")
    .select("workspace_id, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);

  if (memberError) throw memberError;
  if (memberRows?.[0]?.workspace_id) {
    return String(memberRows[0].workspace_id);
  }

  const { data: ownedRows, error: ownedError } = await client
    .from("workspaces")
    .select("id, created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (ownedError) throw ownedError;
  return ownedRows?.[0]?.id ? String(ownedRows[0].id) : null;
}

async function ensureMemberRow(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { error } = await client.from("workspace_members").upsert(
    {
      workspace_id: workspaceId,
      user_id: userId,
      role: "admin",
      status: "active",
    },
    { onConflict: "workspace_id,user_id" },
  );
  if (error) throw error;
}

async function seedWorkspaceTools(client: SupabaseClient, workspaceId: string): Promise<void> {
  await ensureToolCatalog(client);
  const { error } = await client.from("workspace_tools").upsert(
    TOOL_CATALOG.map((tool) => ({
      workspace_id: workspaceId,
      tool_id: tool.id,
      status: tool.status,
    })),
    { onConflict: "workspace_id,tool_id" },
  );
  if (error) throw error;
}

function resolveWorkspaceName(user: User, workspaceName?: string): string {
  return (
    workspaceName?.trim() ||
    (typeof user.user_metadata?.workspace_name === "string"
      ? user.user_metadata.workspace_name
      : "My AI Workspace")
  );
}

/**
 * Always inserts a new workspace + admin membership + tool/Maya/provider seed.
 * Used for additional HQs; bootstrap uses this only when the user has none yet.
 */
export async function createWorkspaceForUser(
  client: SupabaseClient,
  user: User,
  workspaceName?: string,
  options?: { sendWelcome?: boolean },
): Promise<CreateWorkspaceResult> {
  if (!isEmailConfirmed(user)) {
    throw new AccountLifecycleError(
      "email_not_confirmed",
      "Confirm your email before creating a workspace.",
      403,
    );
  }

  const name = resolveWorkspaceName(user, workspaceName);

  const now = new Date().toISOString();
  const { data: workspaceRow, error: workspaceError } = await client
    .from("workspaces")
    .insert({
      name,
      plan: "free",
      plan_slug: "free",
      free_plan_started_at: now,
      current_plan_started_at: now,
      workspace_mode: "real",
      owner_id: user.id,
      onboarding_complete: false,
    })
    .select("*")
    .single();

  if (workspaceError) throw workspaceError;

  const workspaceId = String((workspaceRow as DbRow).id);

  const { initializeFreePlanTerm } = await import("@/lib/billing/plans/plan-terms");
  await initializeFreePlanTerm(client, workspaceId, user.id).catch((error) => {
    console.warn("[AdeHQ plan terms] initialize free term failed", error);
  });

  await ensureMemberRow(client, workspaceId, user.id);
  await seedWorkspaceTools(client, workspaceId);
  await ensureMayaForWorkspace(client, workspaceId);
  await ensureWorkspaceProviderAllocations(client, workspaceId, user.id).catch((error) => {
    console.warn("[AdeHQ provider allocations create]", error);
  });

  // Mailbox is claim-first — owners claim via Settings → Inbox. Do not auto-provision.

  if (options?.sendWelcome) {
    void sendWelcomeEmail(user, workspaceId);
  }

  return { workspaceId, workspaceName: name };
}

/** Idempotent — returns existing workspace or creates exactly one. */
export async function bootstrapWorkspaceForUser(
  client: SupabaseClient,
  user: User,
  workspaceName?: string,
): Promise<BootstrapWorkspaceResult> {
  if (!isEmailConfirmed(user)) {
    throw new AccountLifecycleError(
      "email_not_confirmed",
      "Confirm your email before creating a workspace.",
      403,
    );
  }

  const name = resolveWorkspaceName(user, workspaceName);
  const existingId = await findExistingWorkspaceId(client, user.id);
  if (existingId) {
    await ensureMemberRow(client, existingId, user.id);
    await ensureWorkspaceProviderAllocations(client, existingId, user.id).catch((error) => {
      console.warn("[AdeHQ provider allocations bootstrap]", error);
    });
    const { data, error } = await client
      .from("workspaces")
      .select("name")
      .eq("id", existingId)
      .single();
    if (error) throw error;
    return {
      workspaceId: existingId,
      workspaceName: String(data.name),
      created: false,
    };
  }

  try {
    const created = await createWorkspaceForUser(client, user, name, { sendWelcome: true });
    return { ...created, created: true };
  } catch (workspaceError) {
    const raced = await findExistingWorkspaceId(client, user.id);
    if (raced) {
      const { data, error } = await client
        .from("workspaces")
        .select("name")
        .eq("id", raced)
        .single();
      if (error) throw error;
      return { workspaceId: raced, workspaceName: String(data.name), created: false };
    }
    throw workspaceError;
  }
}
