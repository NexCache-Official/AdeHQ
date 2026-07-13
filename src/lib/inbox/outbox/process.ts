/**
 * Outbound outbox claim + send worker.
 * Respects the undo window: queued rows younger than UNDO_SEND_MS are left alone.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { getWorkspaceEmailProvider } from "@/lib/inbox/provider/resend";
import { undoEligibleBeforeIso } from "@/lib/inbox/outbox/undo";

export async function processOutboxItem(
  client: SupabaseClient,
  outboxId: string,
  opts?: { ignoreUndoWindow?: boolean },
): Promise<{ ok: boolean; reason?: string }> {
  const workerId = `outbox-${process.pid}-${Date.now()}`;

  if (!opts?.ignoreUndoWindow) {
    const { data: peek } = await client
      .from("email_outbox")
      .select("id, status, created_at")
      .eq("id", outboxId)
      .maybeSingle();
    if (!peek) return { ok: true, reason: "missing" };
    if (peek.status === "cancelled") return { ok: true, reason: "cancelled" };
    if (
      (peek.status === "queued" || peek.status === "approved") &&
      String(peek.created_at) > undoEligibleBeforeIso()
    ) {
      return { ok: true, reason: "undo_window" };
    }
  }

  const { data: claimed, error: claimErr } = await client
    .from("email_outbox")
    .update({
      status: "sending",
      locked_at: new Date().toISOString(),
      locked_by: workerId,
    })
    .eq("id", outboxId)
    .in("status", ["queued", "approved"])
    .select("*")
    .maybeSingle();

  if (claimErr) throw claimErr;
  if (!claimed) return { ok: true, reason: "not_claimable" };

  try {
    const provider = getWorkspaceEmailProvider();
    const from = claimed.from_name
      ? `${claimed.from_name} <${claimed.from_address}>`
      : String(claimed.from_address);

    const attachments = Array.isArray(claimed.attachment_payload)
      ? (
          claimed.attachment_payload as Array<{
            filename: string;
            contentBase64: string;
            contentType?: string;
          }>
        ).map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.contentBase64, "base64"),
          contentType: a.contentType,
        }))
      : undefined;

    const result = await provider.sendEmail({
      from,
      to: claimed.to_addresses as string[],
      cc: (claimed.cc_addresses as string[]) ?? [],
      bcc: (claimed.bcc_addresses as string[]) ?? [],
      subject: String(claimed.subject),
      text: claimed.text_body ? String(claimed.text_body) : undefined,
      html: claimed.html_body ? String(claimed.html_body) : undefined,
      headers: (claimed.headers as Record<string, string>) ?? undefined,
      attachments,
      idempotencyKey: String(claimed.idempotency_key),
      tags: [
        { name: "adehq_inbox", value: "1" },
        { name: "adehq_outbox", value: String(claimed.id).slice(0, 32) },
      ],
    });

    let threadId = claimed.thread_id ? String(claimed.thread_id) : null;
    if (!threadId) {
      const { data: thread, error: tErr } = await client
        .from("email_threads")
        .insert({
          workspace_id: claimed.workspace_id,
          mailbox_id: claimed.mailbox_id,
          subject: claimed.subject,
          normalised_subject: String(claimed.subject).toLowerCase(),
          status: "waiting",
          folder: "sent",
          direction_state: "outbound",
          latest_direction: "outbound",
          has_unread: false,
          is_spam: false,
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (tErr) throw tErr;
      threadId = String(thread.id);
    }

    const headers = (claimed.headers as Record<string, string>) ?? {};
    const { data: message, error: mErr } = await client
      .from("email_messages")
      .insert({
        workspace_id: claimed.workspace_id,
        mailbox_id: claimed.mailbox_id,
        thread_id: threadId,
        direction: "outbound",
        from_address: claimed.from_address,
        from_name: claimed.from_name,
        to_addresses: claimed.to_addresses,
        cc_addresses: claimed.cc_addresses,
        bcc_addresses: claimed.bcc_addresses,
        subject: claimed.subject,
        text_body: claimed.text_body,
        html_body_sanitised: claimed.html_body,
        headers,
        message_id_header: headers["Message-ID"] ?? null,
        in_reply_to_header: headers["In-Reply-To"] ?? null,
        references_header: headers.References ?? null,
        provider_message_id: result.providerMessageId,
        mailbox_type: "adehq_managed",
        sent_by_type: claimed.sent_by_type,
        sent_by_id: claimed.sent_by_id,
        delivery_status: "sent",
        outbox_id: claimed.id,
      })
      .select("id")
      .single();
    if (mErr) throw mErr;

    await client
      .from("email_outbox")
      .update({
        status: "sent",
        provider_message_id: result.providerMessageId,
        message_id: message.id,
        thread_id: threadId,
        sent_at: new Date().toISOString(),
        attempt_count: Number(claimed.attempt_count ?? 0) + 1,
        error: null,
      })
      .eq("id", claimed.id);

    if (claimed.draft_id) {
      await client
        .from("email_drafts")
        .update({ status: "sent" })
        .eq("id", claimed.draft_id)
        .eq("mailbox_id", claimed.mailbox_id);
    }

    const { data: existingThread } = await client
      .from("email_threads")
      .select("direction_state")
      .eq("id", threadId)
      .maybeSingle();
    const prevDirection = String(existingThread?.direction_state ?? "outbound");
    const nextDirectionState =
      prevDirection === "inbound" || prevDirection === "mixed" ? "mixed" : "outbound";

    await client
      .from("email_threads")
      .update({
        last_message_at: new Date().toISOString(),
        folder: "sent",
        latest_direction: "outbound",
        direction_state: nextDirectionState,
        status: "waiting",
      })
      .eq("id", threadId);

    await recordEmailEvent(client, {
      workspaceId: String(claimed.workspace_id),
      mailboxId: String(claimed.mailbox_id),
      threadId,
      messageId: String(message.id),
      actorType: (claimed.sent_by_type as "human" | "ai_employee" | "system") ?? "system",
      actorId: claimed.sent_by_id ? String(claimed.sent_by_id) : null,
      eventType: "email.sent",
      payload: { providerMessageId: result.providerMessageId, outboxId: claimed.id },
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Persist a failed outbound message so the thread shows undelivered state.
    let threadId = claimed.thread_id ? String(claimed.thread_id) : null;
    try {
      if (!threadId) {
        const { data: thread } = await client
          .from("email_threads")
          .insert({
            workspace_id: claimed.workspace_id,
            mailbox_id: claimed.mailbox_id,
            subject: claimed.subject,
            normalised_subject: String(claimed.subject).toLowerCase(),
            status: "waiting",
            folder: "sent",
            direction_state: "outbound",
            latest_direction: "outbound",
            has_unread: false,
            is_spam: false,
            last_message_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        threadId = thread ? String(thread.id) : null;
      }

      if (threadId) {
        const baseHeaders = (claimed.headers as Record<string, string>) ?? {};
        const headers: Record<string, string> = {
          ...baseHeaders,
          "X-AdeHQ-Delivery-Error": message.slice(0, 500),
        };
        const { data: failedMsg } = await client
          .from("email_messages")
          .insert({
            workspace_id: claimed.workspace_id,
            mailbox_id: claimed.mailbox_id,
            thread_id: threadId,
            direction: "outbound",
            from_address: claimed.from_address,
            from_name: claimed.from_name,
            to_addresses: claimed.to_addresses,
            cc_addresses: claimed.cc_addresses,
            bcc_addresses: claimed.bcc_addresses,
            subject: claimed.subject,
            text_body: claimed.text_body,
            html_body_sanitised: claimed.html_body,
            headers,
            message_id_header: headers["Message-ID"] ?? null,
            mailbox_type: "adehq_managed",
            sent_by_type: claimed.sent_by_type,
            sent_by_id: claimed.sent_by_id,
            delivery_status: "failed",
            outbox_id: claimed.id,
          })
          .select("id")
          .single();

        await client
          .from("email_threads")
          .update({
            last_message_at: new Date().toISOString(),
            latest_direction: "outbound",
            status: "waiting",
          })
          .eq("id", threadId);

        await client
          .from("email_outbox")
          .update({
            status: "failed",
            error: message,
            thread_id: threadId,
            message_id: failedMsg?.id ?? null,
            attempt_count: Number(claimed.attempt_count ?? 0) + 1,
          })
          .eq("id", claimed.id);
        return { ok: false, reason: message };
      }
    } catch (persistErr) {
      console.warn("[inbox] failed to persist undelivered message", persistErr);
    }

    await client
      .from("email_outbox")
      .update({
        status: "failed",
        error: message,
        attempt_count: Number(claimed.attempt_count ?? 0) + 1,
      })
      .eq("id", claimed.id);
    return { ok: false, reason: message };
  }
}

export async function processQueuedOutbox(
  client: SupabaseClient,
  limit = 5,
): Promise<number> {
  const { data, error } = await client
    .from("email_outbox")
    .select("id")
    .in("status", ["queued", "approved"])
    .lte("created_at", undoEligibleBeforeIso())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let n = 0;
  for (const row of data ?? []) {
    await processOutboxItem(client, String(row.id));
    n += 1;
  }
  return n;
}

/** Cancel a queued send while still inside the undo window. */
export async function cancelOutboxItem(
  client: SupabaseClient,
  params: { outboxId: string; mailboxId: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await client
    .from("email_outbox")
    .update({
      status: "cancelled",
      error: "Cancelled by user",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.outboxId)
    .eq("mailbox_id", params.mailboxId)
    .eq("status", "queued")
    .select("id, draft_id")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "not_cancellable" };

  // Re-open the draft so the composer can continue editing after undo.
  if (data.draft_id) {
    await client
      .from("email_drafts")
      .update({ status: "draft" })
      .eq("id", data.draft_id)
      .eq("mailbox_id", params.mailboxId)
      .eq("status", "sent");
  }

  return { ok: true };
}
