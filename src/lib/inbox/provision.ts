/**
 * Primary mailbox provisioning — immutable canonical_local_part.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getInboxDomain } from "./config";
import type { AssistanceMode } from "./types";

function slugifyLocalPart(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

function shortId(workspaceId: string): string {
  return workspaceId.replace(/-/g, "").slice(0, 8);
}

export type EnsureMailboxResult = {
  mailboxId: string;
  address: string;
  created: boolean;
};

/**
 * Ensure the workspace has a primary AdeHQ-managed mailbox.
 * Canonical local-part is stable after first creation (slug changes do not alter it).
 */
export async function ensurePrimaryMailbox(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    workspaceName: string;
    assistanceMode?: AssistanceMode;
  },
): Promise<EnsureMailboxResult> {
  const domain = getInboxDomain();

  const existing = await client
    .from("workspace_mailboxes")
    .select("id, canonical_local_part, domain")
    .eq("workspace_id", params.workspaceId)
    .eq("is_primary", true)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) {
    return {
      mailboxId: String(existing.data.id),
      address: `${existing.data.canonical_local_part}@${existing.data.domain}`,
      created: false,
    };
  }

  const preferred = slugifyLocalPart(params.workspaceName);
  const candidates = [preferred, `${preferred}-${shortId(params.workspaceId)}`, `ws-${shortId(params.workspaceId)}`];

  let lastError: Error | null = null;
  for (const localPart of candidates) {
    const { data, error } = await client
      .from("workspace_mailboxes")
      .insert({
        workspace_id: params.workspaceId,
        canonical_local_part: localPart,
        domain,
        display_name: params.workspaceName,
        is_primary: true,
        status: "active",
        mailbox_type: "adehq_managed",
        assistance_mode: params.assistanceMode ?? "ai_triage_suggested_replies",
      })
      .select("id, canonical_local_part, domain")
      .single();

    if (!error && data) {
      await client.from("email_identities").insert({
        workspace_id: params.workspaceId,
        mailbox_id: data.id,
        display_name: params.workspaceName,
        is_default: true,
      });

      await client.from("email_events").insert({
        workspace_id: params.workspaceId,
        mailbox_id: data.id,
        actor_type: "system",
        event_type: "mailbox.provisioned",
        payload: { address: `${data.canonical_local_part}@${data.domain}` },
      });

      return {
        mailboxId: String(data.id),
        address: `${data.canonical_local_part}@${data.domain}`,
        created: true,
      };
    }
    lastError = error ? new Error(error.message) : new Error("insert failed");
  }

  throw lastError ?? new Error("Failed to provision primary mailbox");
}

export async function resolveMailboxByRecipient(
  client: SupabaseClient,
  recipient: string,
): Promise<{ workspaceId: string; mailboxId: string } | null> {
  const normalized = recipient.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);

  const primary = await client
    .from("workspace_mailboxes")
    .select("id, workspace_id, status")
    .eq("canonical_local_part", local)
    .eq("domain", domain)
    .maybeSingle();
  if (primary.error) throw primary.error;
  if (primary.data && primary.data.status === "active") {
    return { workspaceId: String(primary.data.workspace_id), mailboxId: String(primary.data.id) };
  }

  const alias = await client
    .from("mailbox_aliases")
    .select("mailbox_id, workspace_id, is_active")
    .eq("local_part", local)
    .eq("domain", domain)
    .maybeSingle();
  if (alias.error) throw alias.error;
  if (alias.data && alias.data.is_active) {
    return { workspaceId: String(alias.data.workspace_id), mailboxId: String(alias.data.mailbox_id) };
  }

  return null;
}
