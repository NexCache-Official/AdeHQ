/**
 * GET  /api/inbox/drafts?workspaceId=   — list draft-status drafts (Drafts folder)
 * POST /api/inbox/drafts                — create a draft
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { createDraft } from "@/lib/inbox/drafts";
import { mapDraftRow } from "@/lib/inbox/mailbox";
import type { DraftDTO } from "@/lib/inbox/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "read",
    );

    const { data: drafts, error } = await ctx.secret
      .from("email_drafts")
      .select(
        "id, thread_id, status, current_version_id, updated_at, created_at, origin_type, requires_approval, is_stale, stale_reason, employee_id, rewrite_count, based_on_message_id",
      )
      .eq("mailbox_id", ctx.mailbox.id)
      .in("status", ["draft", "pending_approval", "approved"])
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const versionIds = (drafts ?? [])
      .map((d) => d.current_version_id)
      .filter(Boolean) as string[];
    const versionById = new Map<string, Record<string, unknown>>();
    if (versionIds.length > 0) {
      const { data: versions } = await ctx.secret
        .from("email_draft_versions")
        .select("id, to_addresses, cc_addresses, bcc_addresses, subject, text_body, html_body")
        .in("id", versionIds);
      for (const v of versions ?? []) versionById.set(String(v.id), v);
    }

    const draftIds = (drafts ?? []).map((d) => String(d.id));
    const approvalByDraft = new Map<
      string,
      { status: string | null; id: string | null; expiresAt: string | null }
    >();
    if (draftIds.length > 0) {
      const { data: approvals } = await ctx.secret
        .from("email_approvals")
        .select("id, draft_id, status, expires_at, draft_version_id")
        .in("draft_id", draftIds)
        .in("status", ["pending", "approved", "rejected"])
        .order("created_at", { ascending: false });
      for (const a of approvals ?? []) {
        const did = String(a.draft_id);
        if (approvalByDraft.has(did)) continue;
        approvalByDraft.set(did, {
          status: String(a.status),
          id: String(a.id),
          expiresAt: a.expires_at ? String(a.expires_at) : null,
        });
      }
    }

    const result: DraftDTO[] = (drafts ?? []).map((d) =>
      mapDraftRow(
        d,
        d.current_version_id ? versionById.get(String(d.current_version_id)) ?? null : null,
        approvalByDraft.get(String(d.id)) ?? null,
      ),
    );
    return NextResponse.json({ drafts: result });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      threadId?: string | null;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      textBody?: string | null;
      htmlBody?: string | null;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "send");

    const draft = await createDraft(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      userId: ctx.user.id,
      threadId: body.threadId ?? null,
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
