// ===========================================================================
// AdeHQ email adapter — email.createDraft creates a reviewable email_draft
// artifact (never sends). Sending arrives in Phase 4 behind approval.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type { CreateEmailDraftArgs } from "@/lib/integrations/registry/tool-definitions";
import { randomUUID } from "node:crypto";
import { emailMarkdownFromJson, type EmailDraftJson } from "@/lib/artifacts/intelligence";
import { saveArtifactToDrive } from "./adehq-storage";

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

  return {
    summary: `Drafted email "${args.subject}"${args.recipientName ? ` to ${args.recipientName}` : ""} — saved as a reviewable draft.`,
    payload: {
      artifactId,
      title,
      subject: json.subject,
      body: json.body,
      recipientName: json.recipientName,
      recipientOrganization: json.recipientOrganization,
    },
    objectId: artifactId,
    workLogAction: "created_email_draft",
    relatedEntityType: "artifact",
    relatedEntityId: artifactId,
  };
}
