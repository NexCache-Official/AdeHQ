/**
 * GET /api/inbox/drafts/[draftId]/versions — version history for provenance UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { AuthError } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

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

    const { data: draft } = await ctx.secret
      .from("email_drafts")
      .select("id, mailbox_id, current_version_id, rewrite_count, origin_type, employee_id")
      .eq("id", draftId)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!draft) throw new AuthError("Draft not found.", 404);

    const { data: versions, error } = await ctx.secret
      .from("email_draft_versions")
      .select(
        "id, version_number, subject, text_body, html_body, to_addresses, cc_addresses, bcc_addresses, is_original_ai, created_by_type, created_by_id, created_at",
      )
      .eq("draft_id", draftId)
      .order("version_number", { ascending: false })
      .limit(50);
    if (error) throw error;

    return NextResponse.json({
      draftId,
      currentVersionId: draft.current_version_id,
      rewriteCount: Number(draft.rewrite_count ?? 0),
      originType: draft.origin_type,
      employeeId: draft.employee_id,
      versions: (versions ?? []).map((v) => ({
        id: String(v.id),
        versionNumber: Number(v.version_number),
        subject: String(v.subject ?? ""),
        textBody: (v.text_body as string) ?? null,
        htmlBody: (v.html_body as string) ?? null,
        to: (v.to_addresses as string[]) ?? [],
        cc: (v.cc_addresses as string[]) ?? [],
        bcc: (v.bcc_addresses as string[]) ?? [],
        isOriginalAi: Boolean(v.is_original_ai),
        createdByType: String(v.created_by_type),
        createdById: (v.created_by_id as string) ?? null,
        createdAt: String(v.created_at),
      })),
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
