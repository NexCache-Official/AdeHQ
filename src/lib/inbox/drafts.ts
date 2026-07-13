/**
 * Draft persistence (Slice B). Autosave overwrites the current version in place
 * to avoid unbounded version growth; the version history table remains for
 * Slice C (AI drafts / approvals).
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftDTO } from "./types";
import { mapDraftRow } from "./mailbox";

export type DraftInput = {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  textBody?: string | null;
  htmlBody?: string | null;
};

function contentHash(input: DraftInput): string {
  const payload = JSON.stringify({
    to: input.to ?? [],
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    subject: input.subject ?? "",
    text: input.textBody ?? "",
    html: input.htmlBody ?? "",
  });
  return createHash("sha256").update(payload).digest("hex");
}

export async function createDraft(
  secret: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    userId: string;
    threadId?: string | null;
    input: DraftInput;
  },
): Promise<DraftDTO> {
  const { data: draft, error: draftError } = await secret
    .from("email_drafts")
    .insert({
      workspace_id: params.workspaceId,
      mailbox_id: params.mailboxId,
      thread_id: params.threadId ?? null,
      status: "draft",
      created_by_type: "human",
      created_by_id: params.userId,
      origin_type: "human",
      current_author_type: "human",
      requires_approval: false,
    })
    .select("*")
    .single();
  if (draftError) throw draftError;

  const version = await insertVersion(secret, {
    workspaceId: params.workspaceId,
    draftId: String(draft.id),
    userId: params.userId,
    versionNumber: 1,
    input: params.input,
  });

  await secret
    .from("email_drafts")
    .update({ current_version_id: version.id })
    .eq("id", draft.id);

  return mapDraftRow(draft, version);
}

export async function updateDraft(
  secret: SupabaseClient,
  params: {
    draftId: string;
    userId: string;
    input: DraftInput;
  },
): Promise<DraftDTO> {
  const { data: draft, error: draftError } = await secret
    .from("email_drafts")
    .select("*")
    .eq("id", params.draftId)
    .single();
  if (draftError) throw draftError;
  if (draft.status !== "draft") {
    throw new Error("This draft can no longer be edited.");
  }

  const patch = {
    to_addresses: params.input.to ?? [],
    cc_addresses: params.input.cc ?? [],
    bcc_addresses: params.input.bcc ?? [],
    subject: params.input.subject ?? "",
    text_body: params.input.textBody ?? null,
    html_body: params.input.htmlBody ?? null,
    content_hash: contentHash(params.input),
  };

  let version: Record<string, unknown> | null = null;
  if (draft.current_version_id) {
    const { data, error } = await secret
      .from("email_draft_versions")
      .update(patch)
      .eq("id", draft.current_version_id)
      .select("*")
      .single();
    if (error) throw error;
    version = data;
  } else {
    version = await insertVersion(secret, {
      workspaceId: String(draft.workspace_id),
      draftId: String(draft.id),
      userId: params.userId,
      versionNumber: 1,
      input: params.input,
    });
    await secret
      .from("email_drafts")
      .update({ current_version_id: version.id })
      .eq("id", draft.id);
  }

  // Bump updated_at so autosave is observable via realtime.
  // AI-origin drafts stay approval-required even after human edits.
  const draftPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    current_author_type: "human",
  };
  if (draft.origin_type === "ai_employee" || draft.requires_approval) {
    draftPatch.requires_approval = true;
    draftPatch.status = "draft";
  }
  await secret.from("email_drafts").update(draftPatch).eq("id", draft.id);

  if (draft.origin_type === "ai_employee" || draft.requires_approval) {
    await secret
      .from("email_approvals")
      .update({ status: "invalidated" })
      .eq("draft_id", draft.id)
      .in("status", ["pending", "approved"]);
    if (draft.thread_id) {
      await secret
        .from("email_threads")
        .update({ latest_valid_approval_id: null })
        .eq("id", draft.thread_id);
    }
  }

  return mapDraftRow({ ...draft, ...draftPatch }, version);
}

async function insertVersion(
  secret: SupabaseClient,
  params: {
    workspaceId: string;
    draftId: string;
    userId: string;
    versionNumber: number;
    input: DraftInput;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await secret
    .from("email_draft_versions")
    .insert({
      workspace_id: params.workspaceId,
      draft_id: params.draftId,
      version_number: params.versionNumber,
      to_addresses: params.input.to ?? [],
      cc_addresses: params.input.cc ?? [],
      bcc_addresses: params.input.bcc ?? [],
      subject: params.input.subject ?? "",
      text_body: params.input.textBody ?? null,
      html_body: params.input.htmlBody ?? null,
      content_hash: contentHash(params.input),
      created_by_type: "human",
      created_by_id: params.userId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function discardDraft(secret: SupabaseClient, draftId: string): Promise<void> {
  const { error } = await secret
    .from("email_drafts")
    .update({ status: "discarded" })
    .eq("id", draftId);
  if (error) throw error;
}
