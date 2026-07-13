/**
 * POST /api/inbox/mailboxes/claim — owner/admin claims the workspace's one
 * shared mailbox. The canonical local-part is immutable after this.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkspaceAdmin } from "@/lib/inbox/access";
import { validateLocalPart } from "@/lib/inbox/local-part";
import { getInboxDomain } from "@/lib/inbox/config";
import { getPrimaryMailbox } from "@/lib/inbox/mailbox";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      localPart?: string;
      displayName?: string;
    };
    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }

    const secret = createSupabaseSecretClient();
    await requireWorkspaceAdmin(secret, { workspaceId: body.workspaceId, userId: user.id });

    // One shared mailbox per workspace — reject if already claimed.
    const existing = await getPrimaryMailbox(secret, body.workspaceId);
    if (existing) {
      return NextResponse.json(
        { error: "This workspace already has a mailbox.", mailbox: existing },
        { status: 409 },
      );
    }

    const validation = validateLocalPart(body.localPart ?? "");
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }
    const local = validation.value;
    const domain = getInboxDomain();

    // Advisory pre-check against tombstones (DB constraint is authoritative).
    const reserved = await secret
      .from("mailbox_address_reservations")
      .select("domain")
      .eq("domain", domain)
      .eq("local_part", local)
      .maybeSingle();
    if (reserved.data) {
      return NextResponse.json(
        { error: "That address was previously used and can't be reclaimed." },
        { status: 409 },
      );
    }

    const displayName = (body.displayName ?? "").trim().slice(0, 120);

    const { data, error } = await secret
      .from("workspace_mailboxes")
      .insert({
        workspace_id: body.workspaceId,
        canonical_local_part: local,
        domain,
        display_name: displayName,
        is_primary: true,
        status: "active",
        mailbox_type: "adehq_managed",
        assistance_mode: "ai_triage",
      })
      .select("id, canonical_local_part, domain")
      .single();

    if (error) {
      // Unique violation → someone claimed it first (or the local-part is taken).
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That address was just taken. Try another." },
          { status: 409 },
        );
      }
      throw error;
    }

    const mailboxId = String(data.id);
    const address = `${data.canonical_local_part}@${data.domain}`;

    // Default identity + seed owner/admin grants + audit event.
    await secret.from("email_identities").insert({
      workspace_id: body.workspaceId,
      mailbox_id: mailboxId,
      display_name: displayName || "Workspace",
      is_default: true,
    });

    const { data: admins } = await secret
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", body.workspaceId)
      .eq("status", "active")
      .in("role", ["owner", "admin"]);

    if (admins && admins.length > 0) {
      await secret.from("email_mailbox_access").upsert(
        admins.map((a) => ({
          workspace_id: body.workspaceId,
          mailbox_id: mailboxId,
          user_id: String(a.user_id),
          can_read: true,
          can_send: true,
          can_manage: true,
          granted_by: user.id,
        })),
        { onConflict: "mailbox_id,user_id" },
      );
    }

    await secret.from("email_events").insert({
      workspace_id: body.workspaceId,
      mailbox_id: mailboxId,
      actor_type: "human",
      actor_id: user.id,
      event_type: "mailbox.claimed",
      payload: { address },
    });

    await secret.from("email_events").insert({
      workspace_id: body.workspaceId,
      mailbox_id: mailboxId,
      actor_type: "human",
      actor_id: user.id,
      event_type: "mailbox.assistance_consent",
      payload: {
        assistanceMode: "ai_triage",
        consent:
          "AdeHQ will classify and prioritise incoming email. It will not generate or send replies unless you request it.",
      },
    });

    return NextResponse.json({ ok: true, mailboxId, address });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
