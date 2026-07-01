import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { dismissTopicSuggestion, acceptTopicSuggestion } from "@/lib/orchestration/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { suggestionId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as { status?: "dismissed" | "accepted"; workspaceId?: string };
    const workspaceId = body.workspaceId;
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    if (body.status === "accepted") {
      await acceptTopicSuggestion(client, workspaceId, params.suggestionId, user.id);
    } else {
      await dismissTopicSuggestion(client, workspaceId, params.suggestionId, user.id);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic-suggestions PATCH]", error);
    return NextResponse.json({ error: "Unable to update suggestion." }, { status: 500 });
  }
}
