import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  AccountLifecycleError,
  purgeIncompleteWorkspace,
} from "@/lib/server/account-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Discard an incomplete onboarding workspace (owner only).
 * Removes it from the DB (cascade) so it disappears from the switcher.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, params.workspaceId, user.id);

    const serviceClient = createSupabaseSecretClient();
    const result = await purgeIncompleteWorkspace(
      serviceClient,
      params.workspaceId,
      user.id,
    );

    // Prefer another completed workspace as next active HQ when possible.
    let nextWorkspaceId: string | null = result.remainingWorkspaceIds[0] ?? null;
    if (result.remainingWorkspaceIds.length > 0) {
      const { data: completed } = await serviceClient
        .from("workspaces")
        .select("id, onboarding_complete")
        .in("id", result.remainingWorkspaceIds);

      const finished = (completed ?? []).find((row) => Boolean(row.onboarding_complete));
      if (finished?.id) nextWorkspaceId = String(finished.id);
    }

    return NextResponse.json({
      ok: true,
      deletedWorkspaceId: result.deletedWorkspaceId,
      remainingWorkspaceIds: result.remainingWorkspaceIds,
      nextWorkspaceId,
      nextAction:
        result.remainingWorkspaceIds.length > 0 ? "switch_workspace" : "create_workspace",
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
    console.error("[AdeHQ cancel-onboarding]", error);
    return NextResponse.json(
      { error: "Unable to cancel onboarding for this workspace." },
      { status: 500 },
    );
  }
}
