import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { EmailCategory } from "./preferences";

export type EmailSendStatus =
  | "sent"
  | "failed"
  | "skipped_unsubscribed"
  | "test_redirected";

export type EmailSendLogInput = {
  template: string;
  category: EmailCategory;
  recipient: string;
  subject: string;
  status: EmailSendStatus;
  provider?: string;
  providerMessageId?: string | null;
  error?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Write one row to email_send_log. Never throws — logging failures must not
 * break the send path (the caller already handled the real outcome).
 */
export async function recordEmailSend(
  input: EmailSendLogInput,
  client?: SupabaseClient,
): Promise<void> {
  try {
    const db = client ?? createServiceRoleClient();
    await db.from("email_send_log").insert({
      template: input.template,
      category: input.category,
      recipient: input.recipient,
      subject: input.subject,
      status: input.status,
      provider: input.provider ?? "resend",
      provider_message_id: input.providerMessageId ?? null,
      error: input.error ?? null,
      workspace_id: input.workspaceId ?? null,
      user_id: input.userId ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    console.error("[AdeHQ email] failed to write email_send_log", err);
  }
}
