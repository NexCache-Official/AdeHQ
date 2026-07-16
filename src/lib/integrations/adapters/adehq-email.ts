// ===========================================================================
// AdeHQ email adapter — workspace inbox drafts, approval-gated send, and
// read-only thread lookup. Outbound send always goes through email_outbox.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type {
  CreateEmailDraftArgs,
  ListRecentEmailsArgs,
  GetEmailThreadArgs,
  SendEmailDraftArgs,
} from "@/lib/integrations/registry/tool-definitions";
import { randomUUID } from "node:crypto";
import { createHash } from "crypto";
import { emailMarkdownFromJson, type EmailDraftJson } from "@/lib/artifacts/intelligence";
import { saveArtifactToDrive } from "./adehq-storage";
import { getPrimaryMailbox } from "@/lib/inbox/mailbox";
import { enqueueOutbound } from "@/lib/inbox/outbox/enqueue";
import {
  approvalExpiryIso,
  computeApprovalHash,
  computeFieldHashes,
} from "@/lib/inbox/steward/envelope";

function textToHtml(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function snippetFrom(text: string | null, html: string | null, max = 160): string {
  const base = (text ?? html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return base.slice(0, max);
}

export async function createEmailDraft(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CreateEmailDraftArgs,
): Promise<ToolExecutionOutput> {
  const json: EmailDraftJson = {
    subject: args.subject.trim(),
    to: args.recipientEmail?.trim() ?? args.recipientName?.trim() ?? null,
    recipientName: args.recipientName?.trim() ?? null,
    recipientOrganization: args.recipientOrganization?.trim() ?? null,
    body: args.body.trim(),
    signature: null,
    placeholders: [...args.body.matchAll(/\[[^\]]+\]/g)].map((m) => m[0]),
    tone: "professional",
    purpose: "outreach",
    complianceNotes: [],
    nextSteps: [],
  };

  const title = args.recipientOrganization
    ? `${args.recipientOrganization} outreach email`
    : args.subject.slice(0, 72);
  const contentMarkdown = emailMarkdownFromJson(json);
  const artifactId = randomUUID();

  const { error } = await client.from("artifacts").insert({
    workspace_id: ctx.workspaceId,
    id: artifactId,
    room_id: ctx.roomId ?? null,
    topic_id: ctx.topicId ?? null,
    title,
    artifact_type: "email_draft",
    status: "draft",
    content_markdown: contentMarkdown,
    content_json: json,
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
    source_file_ids: [],
    source_message_ids: ctx.triggerMessageId ? [ctx.triggerMessageId] : [],
    source_chunk_ids: [],
    source_citations: [],
  });
  if (error) throw error;

  await client.from("artifact_versions").insert({
    artifact_id: artifactId,
    version_number: 1,
    content_markdown: contentMarkdown,
    content_json: json,
    source_citations: [],
    created_by_type: "ai",
    created_by_id: ctx.employeeId,
  });

  await saveArtifactToDrive(client, {
    workspaceId: ctx.workspaceId,
    artifactId,
    title,
    contentMarkdown,
    employeeId: ctx.employeeId,
  });

  let inboxDraftId: string | null = null;
  let mailboxMissing = false;
  try {
    const mailbox = await getPrimaryMailbox(client, ctx.workspaceId);
    if (!mailbox) {
      mailboxMissing = true;
    } else {
      const to = args.recipientEmail?.trim()
        ? [args.recipientEmail.trim().toLowerCase()]
        : [];
      if (to.length === 0) {
        // Inbox drafts need a real address to be sendable later.
      } else {
        const textBody = args.body.trim();
        const htmlBody = textToHtml(textBody);
        const subject = args.subject.trim();
        const contentHash = createHash("sha256")
          .update(JSON.stringify({ to, subject, text: textBody, html: htmlBody }))
          .digest("hex");

        const { data: draft, error: dErr } = await client
          .from("email_drafts")
          .insert({
            workspace_id: ctx.workspaceId,
            mailbox_id: mailbox.id,
            thread_id: ctx.emailThreadId ?? null,
            status: "draft",
            created_by_type: "ai_employee",
            created_by_id: ctx.employeeId,
            origin_type: "ai_employee",
            current_author_type: "ai_employee",
            requires_approval: true,
            employee_id: ctx.employeeId,
            is_stale: false,
            rewrite_count: 0,
          })
          .select("id")
          .single();
        if (!dErr && draft) {
          inboxDraftId = String(draft.id);
          const { data: version } = await client
            .from("email_draft_versions")
            .insert({
              workspace_id: ctx.workspaceId,
              draft_id: inboxDraftId,
              version_number: 1,
              to_addresses: to,
              cc_addresses: [],
              bcc_addresses: [],
              subject,
              text_body: textBody,
              html_body: htmlBody,
              content_hash: contentHash,
              is_original_ai: true,
              created_by_type: "ai_employee",
              created_by_id: ctx.employeeId,
            })
            .select("id")
            .single();
          if (version) {
            await client
              .from("email_drafts")
              .update({ current_version_id: version.id })
              .eq("id", inboxDraftId);
          }
        }
      }
    }
  } catch (inboxErr) {
    console.warn("[adehq-email] workspace inbox draft skipped", inboxErr);
  }

  const nextStep = inboxDraftId
    ? " Call email.sendDraft with this draftId to request send approval — do not claim it was sent."
    : mailboxMissing
      ? " Workspace Inbox is not claimed yet — ask the human to claim an address in Inbox before sending."
      : args.recipientEmail?.trim()
        ? ""
        : " Include recipientEmail next time so the draft can be sent from Inbox.";

  return {
    summary: `Drafted email "${args.subject}"${args.recipientName ? ` to ${args.recipientName}` : args.recipientEmail ? ` to ${args.recipientEmail}` : ""} — saved as a reviewable draft${inboxDraftId ? " in the workspace inbox" : ""}.${nextStep}`,
    payload: {
      artifactId,
      inboxDraftId,
      draftId: inboxDraftId,
      emailThreadId: ctx.emailThreadId ?? null,
      title,
      subject: json.subject,
      body: json.body,
      recipientName: json.recipientName,
      recipientEmail: args.recipientEmail?.trim() ?? null,
      recipientOrganization: json.recipientOrganization,
      requiresApproval: true,
      mailboxClaimed: !mailboxMissing,
    },
    objectId: inboxDraftId ?? artifactId,
    workLogAction: "created_email_draft",
    relatedEntityType: "artifact",
    relatedEntityId: inboxDraftId ?? artifactId,
  };
}

export async function sendEmailDraft(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: SendEmailDraftArgs,
): Promise<ToolExecutionOutput> {
  const draftId = args.draftId.trim();
  const mailbox = await getPrimaryMailbox(client, ctx.workspaceId);
  if (!mailbox) {
    throw new Error(
      "Workspace Inbox is not claimed yet. Ask the human to claim an address in Inbox, then try again.",
    );
  }

  const { data: draft, error: draftErr } = await client
    .from("email_drafts")
    .select(
      "id, workspace_id, mailbox_id, thread_id, status, origin_type, requires_approval, current_version_id, is_stale, employee_id",
    )
    .eq("id", draftId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (draftErr) throw draftErr;
  if (!draft) throw new Error("Email draft not found in this workspace.");
  if (String(draft.mailbox_id) !== mailbox.id) {
    throw new Error("Draft belongs to a different mailbox.");
  }
  if (draft.is_stale) {
    throw new Error("Draft is outdated. Create a fresh draft before sending.");
  }
  if (["sent", "cancelled"].includes(String(draft.status))) {
    throw new Error(`Draft cannot be sent (status: ${draft.status}).`);
  }
  if (!draft.current_version_id) {
    throw new Error("Draft has no current version.");
  }

  const { data: version, error: verErr } = await client
    .from("email_draft_versions")
    .select("*")
    .eq("id", draft.current_version_id)
    .maybeSingle();
  if (verErr) throw verErr;
  if (!version) throw new Error("Draft version missing.");

  const asAddresses = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [])
      .map((a: unknown) => String(a).trim().toLowerCase())
      .filter(Boolean);

  const to = asAddresses(version.to_addresses);
  if (to.length === 0) {
    throw new Error("Draft has no recipient email address.");
  }

  for (const addr of to) {
    const { data: suppressed } = await client
      .from("email_suppressions")
      .select("address")
      .eq("workspace_id", ctx.workspaceId)
      .eq("address", addr)
      .maybeSingle();
    if (suppressed) {
      throw new Error(`Recipient ${addr} is suppressed (bounce/complaint).`);
    }
  }

  const cc = asAddresses(version.cc_addresses);
  const bcc = asAddresses(version.bcc_addresses);
  const subject = String(version.subject ?? "");
  const textBody = String(version.text_body ?? "").trim();
  const htmlBody =
    String(version.html_body ?? "").trim() || (textBody ? textToHtml(textBody) : "");
  const threadId = draft.thread_id ? String(draft.thread_id) : null;

  const envelope = {
    mailboxId: mailbox.id,
    fromAddress: mailbox.address,
    replyTo: null as string | null,
    to,
    cc,
    bcc,
    subject,
    textBody,
    htmlBody,
    attachmentIds: [] as string[],
    attachmentContentHashes: [] as string[],
    threadId: threadId ?? "",
    draftVersionId: String(version.id),
  };
  const approvalHash = computeApprovalHash(envelope);
  const fieldHashes = computeFieldHashes(envelope);

  // Chat tool approval already verified — record a matching inbox approval for audit.
  const { data: approval, error: apprErr } = await client
    .from("email_approvals")
    .insert({
      workspace_id: ctx.workspaceId,
      mailbox_id: mailbox.id,
      draft_id: draftId,
      draft_version_id: version.id,
      thread_id: threadId,
      recipient_hash: fieldHashes.recipientHash,
      subject_hash: fieldHashes.subjectHash,
      body_hash: fieldHashes.bodyHash,
      attachment_hash: fieldHashes.attachmentHash,
      approval_hash: approvalHash,
      from_address: mailbox.address,
      reply_to: null,
      status: "approved",
      approved_by: ctx.requestedByUserId ?? null,
      approved_at: new Date().toISOString(),
      expires_at: approvalExpiryIso(48),
    })
    .select("id")
    .single();
  if (apprErr) throw apprErr;

  let inReplyTo: string | null = null;
  let references: string | null = null;
  if (threadId) {
    const { data: last } = await client
      .from("email_messages")
      .select("message_id_header, references_header")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.message_id_header) {
      inReplyTo = String(last.message_id_header);
      references = last.references_header
        ? `${last.references_header} ${last.message_id_header}`
        : String(last.message_id_header);
    }
  }

  const clientSendId = `ai-send:${draftId}:${version.id}:${ctx.agentRunId ?? "manual"}`;
  const queued = await enqueueOutbound(client, {
    workspaceId: ctx.workspaceId,
    mailboxId: mailbox.id,
    threadId,
    draftId,
    draftVersionId: String(version.id),
    approvalId: String(approval.id),
    fromAddress: mailbox.address,
    fromName: mailbox.displayName || null,
    to,
    cc,
    bcc,
    subject,
    textBody: textBody || undefined,
    htmlBody: htmlBody || undefined,
    inReplyTo,
    references,
    sentByType: "ai_employee",
    sentById: ctx.employeeId,
    clientSendId,
  });

  await client
    .from("email_drafts")
    .update({ status: "approved" })
    .eq("id", draftId)
    .eq("workspace_id", ctx.workspaceId);

  const toLabel = to.join(", ");
  return {
    summary: `Queued email "${subject}" to ${toLabel} from the workspace inbox (undo window applies).`,
    payload: {
      draftId,
      outboxId: queued.outboxId,
      approvalId: approval.id,
      to,
      subject,
      undoUntil: queued.undoUntil,
      deduped: queued.deduped,
      fromAddress: mailbox.address,
    },
    objectId: queued.outboxId,
    workLogAction: "sent_email",
    relatedEntityType: "artifact",
    relatedEntityId: draftId,
  };
}

export async function listRecentEmails(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: ListRecentEmailsArgs,
): Promise<ToolExecutionOutput> {
  const mailbox = await getPrimaryMailbox(client, ctx.workspaceId);
  if (!mailbox) {
    return {
      summary: "Workspace Inbox is not claimed yet — no threads to list.",
      payload: { threads: [], mailboxClaimed: false },
    };
  }

  const limit = Math.min(Math.max(args.limit ?? 10, 1), 25);
  const folder = args.folder ?? "inbox";

  let query = client
    .from("email_threads")
    .select(
      "id, subject, status, has_unread, last_message_at, latest_direction, direction_state, is_spam",
    )
    .eq("mailbox_id", mailbox.id)
    .eq("workspace_id", ctx.workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (folder === "inbox") {
    query = query.eq("is_spam", false).neq("status", "archived");
  } else if (folder === "sent") {
    query = query.in("latest_direction", ["outbound"]).eq("is_spam", false);
  } else if (folder === "archived") {
    query = query.eq("status", "archived");
  }

  const { data, error } = await query;
  if (error) throw error;

  const threads = (data ?? []).map((row) => ({
    id: String(row.id),
    subject: String(row.subject ?? "(no subject)"),
    status: String(row.status ?? ""),
    hasUnread: Boolean(row.has_unread),
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
    latestDirection: row.latest_direction ? String(row.latest_direction) : null,
  }));

  return {
    summary:
      threads.length === 0
        ? `No recent ${folder} threads in the workspace inbox.`
        : `Found ${threads.length} recent ${folder} thread(s) in the workspace inbox.`,
    payload: {
      mailboxAddress: mailbox.address,
      folder,
      threads,
      mailboxClaimed: true,
    },
  };
}

export async function getEmailThread(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: GetEmailThreadArgs,
): Promise<ToolExecutionOutput> {
  const mailbox = await getPrimaryMailbox(client, ctx.workspaceId);
  if (!mailbox) {
    throw new Error("Workspace Inbox is not claimed yet.");
  }

  const threadId = args.threadId.trim();
  const { data: thread, error: tErr } = await client
    .from("email_threads")
    .select("id, subject, status, has_unread, last_message_at, mailbox_id")
    .eq("id", threadId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!thread || String(thread.mailbox_id) !== mailbox.id) {
    throw new Error("Thread not found in this workspace inbox.");
  }

  const msgLimit = Math.min(Math.max(args.messageLimit ?? 8, 1), 20);
  const { data: messages, error: mErr } = await client
    .from("email_messages")
    .select(
      "id, direction, from_address, from_name, to_addresses, subject, text_body, html_body_sanitised, created_at",
    )
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(msgLimit);
  if (mErr) throw mErr;

  const mapped = (messages ?? [])
    .map((m) => ({
      id: String(m.id),
      direction: String(m.direction ?? ""),
      from: String(m.from_name || m.from_address || ""),
      to: Array.isArray(m.to_addresses) ? m.to_addresses.map(String) : [],
      subject: String(m.subject ?? ""),
      snippet: snippetFrom(
        (m.text_body as string) ?? null,
        (m.html_body_sanitised as string) ?? null,
        400,
      ),
      createdAt: m.created_at ? String(m.created_at) : null,
    }))
    .reverse();

  return {
    summary: `Loaded thread "${thread.subject ?? "(no subject)"}" with ${mapped.length} message(s).`,
    payload: {
      threadId,
      subject: String(thread.subject ?? "(no subject)"),
      status: String(thread.status ?? ""),
      messages: mapped,
    },
    objectId: threadId,
  };
}
