/**
 * GET    /api/inbox/drafts/[draftId] — load draft + current version (composer / approval UI)
 * PATCH  /api/inbox/drafts/[draftId] — autosave
 * DELETE /api/inbox/drafts/[draftId] — discard
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { discardDraft, updateDraft } from "@/lib/inbox/drafts";
import { mapDraftRow } from "@/lib/inbox/mailbox";
import { syncPendingEmailSendApprovals } from "@/lib/integrations/sync-email-draft-approvals";
import { AuthError } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

async function assertDraftInMailbox(
  ctx: Awaited<ReturnType<typeof resolveInboxRoute>>,
  draftId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await ctx.secret
    .from("email_drafts")
    .select("id")
    .eq("id", draftId)
    .eq("mailbox_id", ctx.mailbox.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("Draft not found.", 404);
  return data;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  try {
    const { draftId } = await params;
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "read",
    );
    await assertDraftInMailbox(ctx, draftId);

    const { data: draft, error } = await ctx.secret
      .from("email_drafts")
      .select("*")
      .eq("id", draftId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (error) throw error;
    if (!draft) throw new AuthError("Draft not found.", 404);

    let version: Record<string, unknown> | null = null;
    if (draft.current_version_id) {
      const { data: ver } = await ctx.secret
        .from("email_draft_versions")
        .select("*")
        .eq("id", draft.current_version_id)
        .maybeSingle();
      version = ver;
    }

    return NextResponse.json({ draft: mapDraftRow(draft, version) });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  try {
    const { draftId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      textBody?: string | null;
      htmlBody?: string | null;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "send");
    await assertDraftInMailbox(ctx, draftId);

    const draft = await updateDraft(ctx.secret, {
      draftId,
      userId: ctx.user.id,
      input: {
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        textBody: body.textBody,
        htmlBody: body.htmlBody,
      },
    });
    return NextResponse.json({ draft });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  try {
    const { draftId } = await params;
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "send",
    );
    await assertDraftInMailbox(ctx, draftId);
    await discardDraft(ctx.secret, draftId);
    await syncPendingEmailSendApprovals(ctx.secret, {
      workspaceId: ctx.workspaceId,
      draftId,
      status: "rejected",
      resolvedBy: ctx.user.id,
      note: "Draft discarded from Inbox",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
