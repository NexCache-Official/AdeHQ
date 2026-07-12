import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { TOOL_CATALOG } from "@/lib/demo";
import { isEmailConfirmed } from "@/lib/auth/session";
import { ensureToolCatalog } from "@/lib/server/tool-catalog";
import { AccountLifecycleError } from "@/lib/server/account-lifecycle";
import { ensureMayaForWorkspace } from "@/lib/server/ensure-maya";
import { ensureWorkspaceProviderAllocations } from "@/lib/providers/credentials/ensure-workspace-allocations";
import { ensurePrimaryMailbox } from "@/lib/inbox/provision";
import { sendEmail } from "@/lib/email/send";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseSecretClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

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

export type BootstrapWorkspaceResult = {
  workspaceId: string;
  workspaceName: string;
  created: boolean;
};

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
      role: "owner",
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

  const name =
    workspaceName?.trim() ||
    (typeof user.user_metadata?.workspace_name === "string"
      ? user.user_metadata.workspace_name
      : "My AI Workspace");

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
    const existingName = String(data.name);
    try {
      const secret = createSupabaseSecretClient();
      await ensurePrimaryMailbox(secret, {
        workspaceId: existingId,
        workspaceName: existingName,
      });
    } catch (mailboxError) {
      console.warn("[AdeHQ inbox mailbox bootstrap]", mailboxError);
    }
    return {
      workspaceId: existingId,
      workspaceName: existingName,
      created: false,
    };
  }

  const { data: workspaceRow, error: workspaceError } = await client
    .from("workspaces")
    .insert({
      name,
      plan: "Founder",
      workspace_mode: "real",
      owner_id: user.id,
      onboarding_complete: false,
    })
    .select("*")
    .single();

  if (workspaceError) {
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

  const workspaceId = String((workspaceRow as DbRow).id);

  await ensureMemberRow(client, workspaceId, user.id);
  await seedWorkspaceTools(client, workspaceId);
  await ensureMayaForWorkspace(client, workspaceId);
  await ensureWorkspaceProviderAllocations(client, workspaceId, user.id).catch((error) => {
    console.warn("[AdeHQ provider allocations bootstrap]", error);
  });

  // Primary AdeHQ-managed mailbox (immutable canonical address). Best-effort:
  // never block workspace creation if inbox tables are not migrated yet.
  try {
    const secret = createSupabaseSecretClient();
    await ensurePrimaryMailbox(secret, { workspaceId, workspaceName: name });
  } catch (error) {
    console.warn("[AdeHQ inbox mailbox bootstrap]", error);
  }

  // First workspace created (post email-confirmation) — send the branded
  // Welcome email. Preference-gated (product_updates) and best-effort: never
  // block onboarding on email delivery.
  void sendWelcomeEmail(user, workspaceId);

  return { workspaceId, workspaceName: name, created: true };
}
