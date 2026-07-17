import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Explicit inbox teardown before a workspace row is deleted.
 * Most inbox tables cascade from workspaces / mailboxes; this covers:
 * - address reservations (must not block reclaim)
 * - inbound events keyed by mailbox or workspace (including orphans)
 */
export async function purgeWorkspaceInbox(
  client: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const [{ data: mailboxes, error: mailboxError }, { data: aliases, error: aliasError }] =
    await Promise.all([
      client
        .from("workspace_mailboxes")
        .select("id, canonical_local_part, domain")
        .eq("workspace_id", workspaceId),
      client
        .from("mailbox_aliases")
        .select("local_part, domain")
        .eq("workspace_id", workspaceId),
    ]);
  if (mailboxError) throw mailboxError;
  if (aliasError) throw aliasError;

  const mailboxIds = (mailboxes ?? []).map((row) => String(row.id));

  // Free any reservation rows tied to this workspace (legacy tombstones).
  const { error: reservationByWorkspaceError } = await client
    .from("mailbox_address_reservations")
    .delete()
    .eq("workspace_id", workspaceId);
  if (reservationByWorkspaceError) throw reservationByWorkspaceError;

  const addressKeys = new Map<string, { domain: string; local: string }>();
  for (const mailbox of mailboxes ?? []) {
    const local = String(mailbox.canonical_local_part ?? "").trim();
    const domain = String(mailbox.domain ?? "").trim();
    if (local && domain) addressKeys.set(`${domain}\0${local}`, { domain, local });
  }
  for (const alias of aliases ?? []) {
    const local = String(alias.local_part ?? "").trim();
    const domain = String(alias.domain ?? "").trim();
    if (local && domain) addressKeys.set(`${domain}\0${local}`, { domain, local });
  }

  for (const { domain, local } of addressKeys.values()) {
    const { error } = await client
      .from("mailbox_address_reservations")
      .delete()
      .eq("domain", domain)
      .eq("local_part", local);
    if (error) throw error;
  }

  // Inbound events: cascade covers workspace_id, but mailbox_id is ON DELETE SET NULL
  // and many rows start with workspace_id null until routing resolves.
  if (mailboxIds.length > 0) {
    const { error } = await client
      .from("email_inbound_events")
      .delete()
      .in("mailbox_id", mailboxIds);
    if (error) throw error;
  }

  const { error: inboundByWorkspaceError } = await client
    .from("email_inbound_events")
    .delete()
    .eq("workspace_id", workspaceId);
  if (inboundByWorkspaceError) throw inboundByWorkspaceError;

  // Mailboxes + threads/messages/drafts cascade from workspace delete; deleting
  // mailboxes first keeps unique(local_part, domain) free even if the workspace
  // delete fails mid-flight after inbox purge.
  if (mailboxIds.length > 0) {
    const { error } = await client
      .from("workspace_mailboxes")
      .delete()
      .eq("workspace_id", workspaceId);
    if (error) throw error;
  }
}
