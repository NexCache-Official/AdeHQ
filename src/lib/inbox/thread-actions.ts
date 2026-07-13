/**
 * Thread state mutations (Slice B). Writes operational fields; the legacy
 * `folder` column is intentionally left untouched.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

async function patchThread(
  secret: SupabaseClient,
  mailboxId: string,
  threadId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await secret
    .from("email_threads")
    .update(patch)
    .eq("id", threadId)
    .eq("mailbox_id", mailboxId);
  if (error) throw error;
}

export const archiveThread = (s: SupabaseClient, m: string, t: string) =>
  patchThread(s, m, t, { status: "archived" });

export const unarchiveThread = (s: SupabaseClient, m: string, t: string) =>
  patchThread(s, m, t, { status: "open" });

export const markThreadRead = (s: SupabaseClient, m: string, t: string) =>
  patchThread(s, m, t, { has_unread: false });

export const markThreadUnread = (s: SupabaseClient, m: string, t: string) =>
  patchThread(s, m, t, { has_unread: true });

export const setThreadSpam = (s: SupabaseClient, m: string, t: string, spam: boolean) =>
  patchThread(s, m, t, { is_spam: spam });
