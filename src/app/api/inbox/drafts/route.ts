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
      .select("id, thread_id, status, current_version_id, updated_at, created_at")
      .eq("mailbox_id", ctx.mailbox.id)
      .eq("status", "draft")
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

    const result: DraftDTO[] = (drafts ?? []).map((d) =>
      mapDraftRow(d, d.current_version_id ? versionById.get(String(d.current_version_id)) ?? null : null),
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
