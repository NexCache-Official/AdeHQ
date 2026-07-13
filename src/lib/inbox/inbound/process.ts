/**
 * Async inbound processor (Slice A + C).
 * Fetch → sanitise → resolve mailbox → thread → store → steward triage enqueue.
 * Bounce DSN updates outbound delivery and never becomes a customer thread.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyAttachmentRisk } from "@/lib/inbox/attachments";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { getWorkspaceEmailProvider } from "@/lib/inbox/provider/resend";
import { resolveMailboxByRecipient } from "@/lib/inbox/provision";
import { detectPromptInjectionHeuristics, sanitizeInboundHtml } from "@/lib/inbox/sanitize";
import {
  headerGet,
  normaliseSubject,
  parseFrom,
} from "@/lib/inbox/threading";
import { applyDeliveryEvent } from "@/lib/inbox/outbox/delivery";

async function claimInboundEvent(
  client: SupabaseClient,
  eventId: string,
  workerId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("email_inbound_events")
    .update({
      processing_state: "processing",
      locked_at: new Date().toISOString(),
      locked_by: workerId,
    })
    .eq("id", eventId)
    .in("processing_state", ["queued", "received"])
    .select("id, attempt_count")
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;

  await client
    .from("email_inbound_events")
    .update({ attempt_count: Number(data.attempt_count ?? 0) + 1 })
    .eq("id", eventId);

  return true;
}

async function findThreadId(
  client: SupabaseClient,
  workspaceId: string,
  mailboxId: string,
  opts: {
    inReplyTo: string | null;
    references: string | null;
    subject: string;
  },
): Promise<string | null> {
  const candidates: string[] = [];
  if (opts.inReplyTo) candidates.push(opts.inReplyTo);
  if (opts.references) {
    for (const part of opts.references.split(/\s+/)) {
      const t = part.trim();
      if (t) candidates.push(t);
    }
  }

  for (const mid of candidates) {
    const { data } = await client
      .from("email_messages")
      .select("thread_id")
      .eq("workspace_id", workspaceId)
      .eq("message_id_header", mid)
      .maybeSingle();
    if (data?.thread_id) return String(data.thread_id);
  }

  const norm = normaliseSubject(opts.subject);
  if (norm) {
    const { data } = await client
      .from("email_threads")
      .select("id")
      .eq("mailbox_id", mailboxId)
      .eq("normalised_subject", norm)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  return null;
}

export async function processInboundEvent(
  client: SupabaseClient,
  eventId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const workerId = `inbound-${process.pid}-${Date.now()}`;

  const { data: event, error: loadErr } = await client
    .from("email_inbound_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!event) return { ok: false, reason: "event_not_found" };

  const eventType = String(event.event_type ?? "");

  // Delivery / bounce / complaint for outbound messages
  if (
    eventType === "email.delivered" ||
    eventType === "email.bounced" ||
    eventType === "email.complained" ||
    eventType === "email.failed" ||
    eventType === "email.sent"
  ) {
    await applyDeliveryEvent(client, {
      eventType,
      providerMessageId:
        typeof (event.raw_payload as { data?: { email_id?: string } })?.data?.email_id === "string"
          ? (event.raw_payload as { data: { email_id: string } }).data.email_id
          : event.provider_email_id,
      payload: event.raw_payload as Record<string, unknown>,
    });
    await client
      .from("email_inbound_events")
      .update({ processing_state: "ready", processed_at: new Date().toISOString() })
      .eq("id", eventId);
    return { ok: true };
  }

  if (eventType !== "email.received") {
    await client
      .from("email_inbound_events")
      .update({ processing_state: "ready", processed_at: new Date().toISOString() })
      .eq("id", eventId);
    return { ok: true, reason: "ignored_event_type" };
  }

  const claimed = await claimInboundEvent(client, eventId, workerId);
  if (!claimed) {
    return { ok: true, reason: "already_claimed_or_done" };
  }

  const providerEmailId = event.provider_email_id as string | null;
  if (!providerEmailId) {
    await client
      .from("email_inbound_events")
      .update({ processing_state: "failed", error: "missing provider_email_id" })
      .eq("id", eventId);
    return { ok: false, reason: "missing_provider_email_id" };
  }

  try {
    const provider = getWorkspaceEmailProvider();
    const email = await provider.fetchReceivedEmail(providerEmailId);

    const recipients = [
      ...email.to,
      ...email.receivedFor,
      ...email.cc,
    ].map((r) => r.toLowerCase());

    let resolved: { workspaceId: string; mailboxId: string } | null = null;
    for (const r of recipients) {
      const addr = parseFrom(r).address;
      resolved = await resolveMailboxByRecipient(client, addr);
      if (resolved) break;
    }

    if (!resolved) {
      await client
        .from("email_inbound_events")
        .update({
          processing_state: "failed",
          error: `No mailbox for recipients: ${recipients.join(", ")}`,
        })
        .eq("id", eventId);
      return { ok: false, reason: "mailbox_not_found" };
    }

    await client
      .from("email_inbound_events")
      .update({
        workspace_id: resolved.workspaceId,
        mailbox_id: resolved.mailboxId,
      })
      .eq("id", eventId);

    const from = parseFrom(email.from);
    const headers = email.headers ?? {};
    const messageIdHeader =
      email.messageId || headerGet(headers, "message-id") || `<provider.${email.id}@resend>`;
    const inReplyTo = headerGet(headers, "in-reply-to");
    const references = headerGet(headers, "references");

    // Bounce / DSN → update outbound delivery; do not open a customer thread.
    const { handleInboundBounceAsDelivery } = await import("@/lib/inbox/steward/bounce");
    const bounceHandled = await handleInboundBounceAsDelivery(client, {
      workspaceId: resolved.workspaceId,
      mailboxId: resolved.mailboxId,
      fromAddress: from.address,
      subject: email.subject || "",
      textBody: email.text,
      headers,
      eventId,
    });
    if (bounceHandled) {
      await client
        .from("email_inbound_events")
        .update({
          processing_state: "ready",
          processed_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", eventId);
      return { ok: true, reason: "bounce_delivery_updated" };
    }

    const sanitised = sanitizeInboundHtml(email.html);
    const securityFlags = [
      ...sanitised.flags,
      ...detectPromptInjectionHeuristics(email.text),
      ...detectPromptInjectionHeuristics(email.html),
    ];

    let threadId = await findThreadId(client, resolved.workspaceId, resolved.mailboxId, {
      inReplyTo,
      references,
      subject: email.subject,
    });

    if (!threadId) {
      const { data: thread, error: threadErr } = await client
        .from("email_threads")
        .insert({
          workspace_id: resolved.workspaceId,
          mailbox_id: resolved.mailboxId,
          subject: email.subject || "(no subject)",
          normalised_subject: normaliseSubject(email.subject || ""),
          status: "open",
          folder: "inbox",
          direction_state: "inbound",
          latest_direction: "inbound",
          has_unread: true,
          is_spam: false,
          processing_state: "ready",
          last_message_at: new Date().toISOString(),
          mailbox_type: "adehq_managed",
        })
        .select("id")
        .single();
      if (threadErr) throw threadErr;
      threadId = String(thread.id);
    }

    const toAddresses = email.to.map((t) => parseFrom(t).address);
    const ccAddresses = email.cc.map((t) => parseFrom(t).address);

    const { data: message, error: msgErr } = await client
      .from("email_messages")
      .insert({
        workspace_id: resolved.workspaceId,
        mailbox_id: resolved.mailboxId,
        thread_id: threadId,
        direction: "inbound",
        from_address: from.address,
        from_name: from.name,
        to_addresses: toAddresses,
        cc_addresses: ccAddresses,
        bcc_addresses: [],
        reply_to: email.replyTo[0] ?? null,
        subject: email.subject || "(no subject)",
        text_body: email.text,
        html_body_raw: email.html,
        html_body_sanitised: sanitised.html,
        headers,
        message_id_header: messageIdHeader,
        in_reply_to_header: inReplyTo,
        references_header: references,
        provider_email_id: email.id,
        provider_message_id: email.id,
        mailbox_type: "adehq_managed",
        delivery_status: "received",
        security_flags: securityFlags,
        inbound_event_id: eventId,
      })
      .select("id")
      .single();

    if (msgErr) {
      if (msgErr.code === "23505") {
        await client
          .from("email_inbound_events")
          .update({ processing_state: "ready", processed_at: new Date().toISOString() })
          .eq("id", eventId);
        return { ok: true, reason: "duplicate_message" };
      }
      throw msgErr;
    }

    const messageId = String(message.id);

    const participantRows = [
      { role: "from", address: from.address, display_name: from.name },
      ...toAddresses.map((address) => ({ role: "to" as const, address, display_name: null })),
      ...ccAddresses.map((address) => ({ role: "cc" as const, address, display_name: null })),
    ].map((p) => ({
      workspace_id: resolved!.workspaceId,
      message_id: messageId,
      role: p.role,
      address: p.address,
      display_name: p.display_name,
    }));
    if (participantRows.length) {
      await client.from("email_participants").insert(participantRows);
    }

    // Attachments
    try {
      const attMeta = await provider.listReceivedAttachments(email.id);
      for (const att of attMeta) {
        const risk = classifyAttachmentRisk({
          filename: att.filename,
          contentType: att.contentType,
        });
        let storagePath: string | null = null;
        if (risk.quarantineState !== "blocked" && att.downloadUrl) {
          const res = await fetch(att.downloadUrl);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const safeName = (att.filename || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
            storagePath = `${resolved.workspaceId}/inbox/${messageId}/${safeName}`;
            const upload = await client.storage
              .from("email-attachments")
              .upload(storagePath, buf, {
                contentType: att.contentType || "application/octet-stream",
                upsert: false,
              });
            if (upload.error) {
              console.warn("[inbox] attachment upload failed", upload.error.message);
              storagePath = null;
            }
          }
        }
        await client.from("email_attachments").insert({
          workspace_id: resolved.workspaceId,
          message_id: messageId,
          filename: att.filename,
          content_type: att.contentType,
          size_bytes: att.size,
          storage_path: storagePath,
          quarantine_state: risk.quarantineState,
          security_flags: risk.flags,
        });
      }
    } catch (attErr) {
      console.warn("[inbox] attachment processing failed", attErr);
    }

    const { data: existingThread } = await client
      .from("email_threads")
      .select("direction_state, status")
      .eq("id", threadId)
      .maybeSingle();
    const prevDirection = String(existingThread?.direction_state ?? "inbound");
    const nextDirectionState =
      prevDirection === "outbound" || prevDirection === "mixed" ? "mixed" : "inbound";

    await client
      .from("email_threads")
      .update({
        last_message_at: new Date().toISOString(),
        processing_state: "ready",
        folder: "inbox",
        latest_direction: "inbound",
        direction_state: nextDirectionState,
        has_unread: true,
        // Replies reopen the conversation so it appears in Inbox (not stuck in
        // "waiting" after our outbound left the thread awaiting a reply).
        status: "open",
        is_spam: false,
      })
      .eq("id", threadId);

    await recordEmailEvent(client, {
      workspaceId: resolved.workspaceId,
      mailboxId: resolved.mailboxId,
      threadId,
      messageId,
      actorType: "provider",
      eventType: "email.received",
      payload: {
        providerEmailId: email.id,
        securityFlags,
        from: from.address,
      },
    });

    // Slice C: stale AI drafts + enqueue triage (never blocks visibility).
    try {
      const { markDraftsStaleOnInbound, enqueueTriageAfterInbound } = await import(
        "@/lib/inbox/steward/run"
      );
      await markDraftsStaleOnInbound(client, { threadId, newMessageId: messageId });
      const { jobId } = await enqueueTriageAfterInbound(client, {
        workspaceId: resolved.workspaceId,
        mailboxId: resolved.mailboxId,
        threadId,
        messageId,
      });
      if (jobId) {
        // Best-effort drain — must not delay marking inbound ready.
        void import("@/lib/inbox/steward/process")
          .then(({ processEmailJobs }) => processEmailJobs(client, 3))
          .catch((err) => console.warn("[inbox] triage drain nudge failed", err));
      }
    } catch (stewardErr) {
      console.warn("[inbox] steward enqueue failed", stewardErr);
    }

    await client
      .from("email_inbound_events")
      .update({
        processing_state: "ready",
        processed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", eventId);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await client
      .from("email_inbound_events")
      .update({ processing_state: "failed", error: message })
      .eq("id", eventId);
    return { ok: false, reason: message };
  }
}

/** Drain a few queued inbound events (serverless nudge). */
export async function processQueuedInboundEvents(
  client: SupabaseClient,
  limit = 5,
): Promise<number> {
  const { data, error } = await client
    .from("email_inbound_events")
    .select("id")
    .eq("processing_state", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let n = 0;
  for (const row of data ?? []) {
    await processInboundEvent(client, String(row.id));
    n += 1;
  }
  return n;
}
