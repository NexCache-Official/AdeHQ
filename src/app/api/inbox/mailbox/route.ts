/**
 * GET /api/inbox/mailbox?workspaceId= — primary mailbox + this user's access.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getPrimaryMailbox } from "@/lib/inbox/mailbox";
import { getInboxAccess } from "@/lib/inbox/access";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import type { InboxMailboxResponse } from "@/lib/inbox/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }

    const secret = createSupabaseSecretClient();
    const mailbox = await getPrimaryMailbox(secret, workspaceId);
    const access = await getInboxAccess(secret, {
      workspaceId,
      mailboxId: mailbox?.id ?? "00000000-0000-0000-0000-000000000000",
      userId: user.id,
    });

    if (!mailbox) {
      const body: InboxMailboxResponse = { claimed: false, canClaim: access.isAdmin };
      return NextResponse.json(body);
    }

    const body: InboxMailboxResponse = {
      claimed: true,
      mailbox,
      access: {
        role: access.role,
        isAdmin: access.isAdmin,
        canRead: access.canRead,
        canSend: access.canSend,
        canOrganize: access.canOrganize,
        canManage: access.canManage,
      },
    };
    return NextResponse.json(body);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
