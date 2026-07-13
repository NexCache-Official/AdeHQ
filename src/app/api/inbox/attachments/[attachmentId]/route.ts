/**
 * GET /api/inbox/attachments/[attachmentId]?workspaceId=
 * Signed download for a stored inbound attachment (mailbox access required).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { AuthError } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  try {
    const { attachmentId } = await params;
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "read",
    );

    const { data: att, error } = await ctx.secret
      .from("email_attachments")
      .select(
        "id, filename, content_type, size_bytes, storage_path, quarantine_state, message_id, workspace_id",
      )
      .eq("id", attachmentId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!att) throw new AuthError("Attachment not found.", 404);

    // Ensure the attachment belongs to a message on this mailbox.
    const { data: msg } = await ctx.secret
      .from("email_messages")
      .select("id, mailbox_id")
      .eq("id", att.message_id)
      .eq("mailbox_id", ctx.mailbox.id)
      .maybeSingle();
    if (!msg) throw new AuthError("Attachment not found.", 404);

    if (att.quarantine_state === "blocked") {
      return NextResponse.json(
        { error: "This attachment is blocked for security reasons." },
        { status: 403 },
      );
    }
    if (!att.storage_path) {
      return NextResponse.json(
        { error: "Attachment file is not available." },
        { status: 404 },
      );
    }

    const { data: signed, error: signErr } = await ctx.secret.storage
      .from("email-attachments")
      .createSignedUrl(String(att.storage_path), 120);
    if (signErr || !signed?.signedUrl) {
      throw new Error(signErr?.message ?? "Could not create download URL.");
    }

    return NextResponse.json({
      id: att.id,
      filename: att.filename,
      contentType: att.content_type,
      sizeBytes: att.size_bytes,
      quarantineState: att.quarantine_state,
      url: signed.signedUrl,
      expiresInSeconds: 120,
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
