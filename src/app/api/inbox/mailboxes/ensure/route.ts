/**
 * Ensure primary mailbox exists for the current workspace (idempotent).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { ensurePrimaryMailbox } from "@/lib/inbox/provision";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      workspaceName?: string;
    };
    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }

    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const secret = createSupabaseSecretClient();
    let workspaceName = body.workspaceName?.trim();
    if (!workspaceName) {
      const { data } = await secret
        .from("workspaces")
        .select("name")
        .eq("id", body.workspaceId)
        .maybeSingle();
      workspaceName = data?.name ? String(data.name) : "Workspace";
    }

    const result = await ensurePrimaryMailbox(secret, {
      workspaceId: body.workspaceId,
      workspaceName,
    });

    return NextResponse.json({
      ok: true,
      mailboxId: result.mailboxId,
      address: result.address,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
