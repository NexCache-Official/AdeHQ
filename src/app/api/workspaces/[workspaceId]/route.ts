import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AccountLifecycleError, purgeWorkspace } from "@/lib/server/account-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, params.workspaceId, user.id);

    const body = (await request.json().catch(() => ({}))) as {
      confirmName?: string;
    };

    if (!body.confirmName?.trim()) {
      return NextResponse.json(
        { error: "Type the workspace name to confirm deletion." },
        { status: 400 },
      );
    }

    const serviceClient = createServiceRoleClient();
    const result = await purgeWorkspace(
      serviceClient,
      params.workspaceId,
      user.id,
      body.confirmName,
    );

    return NextResponse.json({
      ok: true,
      deletedWorkspaceId: result.deletedWorkspaceId,
      remainingWorkspaceIds: result.remainingWorkspaceIds,
      nextAction:
        result.remainingWorkspaceIds.length > 0 ? "switch_workspace" : "onboarding",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AccountLifecycleError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[AdeHQ workspace DELETE]", error);
    return NextResponse.json({ error: "Unable to delete workspace." }, { status: 500 });
  }
}
