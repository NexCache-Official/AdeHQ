/**
 * Mailbox lookup + recipient resolution (Slice B).
 * Creating a mailbox is claim-only via POST /api/inbox/mailboxes/claim —
 * never auto-slug from the workspace name.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getInboxDomain } from "./config";

/**
 * @deprecated Use claim API only. Kept as a read-only lookup for callers that
 * still import this name — never creates a mailbox.
 */
export async function ensurePrimaryMailbox(
  client: SupabaseClient,
  params: { workspaceId: string; workspaceName: string },
): Promise<{ mailboxId: string; address: string; created: boolean }> {
  const existing = await client
    .from("workspace_mailboxes")
    .select("id, canonical_local_part, domain")
    .eq("workspace_id", params.workspaceId)
    .eq("is_primary", true)
    .neq("status", "retired")
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    return {
      mailboxId: String(existing.data.id),
      address: `${existing.data.canonical_local_part}@${existing.data.domain}`,
      created: false,
    };
  }
  throw new Error(
    `No mailbox claimed for workspace ${params.workspaceId}. Open /inbox to claim an address.`,
  );
}

export async function resolveMailboxByRecipient(
  client: SupabaseClient,
  recipient: string,
): Promise<{ workspaceId: string; mailboxId: string } | null> {
  const normalized = recipient.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1) || getInboxDomain();

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
