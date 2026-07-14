// ===========================================================================
// AdeHQ email adapter — creates a reviewable workspace inbox draft when a
// mailbox is claimed; also keeps an artifact for room/drive visibility.
// Never sends. AI-origin drafts always require approval before send.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type { CreateEmailDraftArgs } from "@/lib/integrations/registry/tool-definitions";
import { randomUUID } from "node:crypto";
import { createHash } from "crypto";
import { emailMarkdownFromJson, type EmailDraftJson } from "@/lib/artifacts/intelligence";
import { saveArtifactToDrive } from "./adehq-storage";
import { getPrimaryMailbox } from "@/lib/inbox/mailbox";

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
  try {
    const mailbox = await getPrimaryMailbox(client, ctx.workspaceId);
    if (mailbox) {
      const to = args.recipientEmail?.trim()
        ? [args.recipientEmail.trim().toLowerCase()]
        : [];
      const textBody = args.body.trim();
      const htmlBody = `<p>${textBody
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>")}</p>`;
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
  } catch (inboxErr) {
    console.warn("[adehq-email] workspace inbox draft skipped", inboxErr);
  }

  return {
    summary: `Drafted email "${args.subject}"${args.recipientName ? ` to ${args.recipientName}` : ""} — saved as a reviewable draft${inboxDraftId ? " in the workspace inbox" : ""}.`,
    payload: {
      artifactId,
      inboxDraftId,
      title,
      subject: json.subject,
      body: json.body,
      recipientName: json.recipientName,
      recipientOrganization: json.recipientOrganization,
      requiresApproval: true,
    },
    objectId: inboxDraftId ?? artifactId,
    workLogAction: "created_email_draft",
    relatedEntityType: "artifact",
    relatedEntityId: inboxDraftId ?? artifactId,
  };
}
