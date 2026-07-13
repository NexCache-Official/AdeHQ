/**
 * GET /api/inbox/mailboxes/availability?workspaceId=&localPart=
 *
 * Advisory only — the DB unique constraint is authoritative. Owner/admin only,
 * lightly rate-limited per workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkspaceAdmin } from "@/lib/inbox/access";
import { validateLocalPart } from "@/lib/inbox/local-part";
import { getInboxDomain } from "@/lib/inbox/config";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

// Best-effort in-process rate limit (10 checks / min / workspace).
const buckets = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > 10;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const localPartRaw = request.nextUrl.searchParams.get("localPart") ?? "";
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }

    const secret = createSupabaseSecretClient();
    await requireWorkspaceAdmin(secret, { workspaceId, userId: user.id });

    if (rateLimited(`${workspaceId}:${user.id}`)) {
      return NextResponse.json(
        { error: "Too many checks. Slow down a moment." },
        { status: 429 },
      );
    }

    const validation = validateLocalPart(localPartRaw);
    if (!validation.ok) {
      return NextResponse.json({ available: false, reason: validation.reason });
    }

    const domain = getInboxDomain();
    const local = validation.value;

    const [mailbox, alias, reserved] = await Promise.all([
      secret
        .from("workspace_mailboxes")
        .select("id")
        .eq("domain", domain)
        .eq("canonical_local_part", local)
        .maybeSingle(),
      secret
        .from("mailbox_aliases")
        .select("id")
        .eq("domain", domain)
        .eq("local_part", local)
        .maybeSingle(),
      secret
        .from("mailbox_address_reservations")
        .select("domain")
        .eq("domain", domain)
        .eq("local_part", local)
        .maybeSingle(),
    ]);

    const taken = Boolean(mailbox.data || alias.data || reserved.data);
    return NextResponse.json({
      available: !taken,
      address: `${local}@${domain}`,
      reason: taken ? "That address is already taken." : null,
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
