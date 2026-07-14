import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { fetchPendingTopicSuggestions } from "@/lib/orchestration/persistence";
import { cleanTopicDescription, cleanTopicTitle } from "@/lib/orchestration/topic-title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isJunkPendingTitle(title: string | null | undefined): boolean {
  const cleaned = title ? cleanTopicTitle(title) : null;
  if (!cleaned) return true;
  return cleaned.split(/\s+/).length < 2;
}

/** List pending topic suggestions for a room (survives refresh / remount). */
export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    const rows = await fetchPendingTopicSuggestions(client, workspaceId, params.roomId);

    // Auto-dismiss junk / unusable pending suggestions so they never resurface.
    const usable = [];
    for (const row of rows) {
      const title = row.title ? String(row.title) : null;
      const type = String(row.type ?? "");
      if (type === "create_topic" && isJunkPendingTitle(title)) {
        await client
          .from("topic_suggestions")
          .update({
            status: "dismissed",
            resolved_by: user.id,
            resolved_at: new Date().toISOString(),
            metadata: {
              ...(typeof row.metadata === "object" && row.metadata && !Array.isArray(row.metadata)
                ? (row.metadata as Record<string, unknown>)
                : {}),
              autoDismissReason: "junk_or_truncated_title",
            },
          })
          .eq("workspace_id", workspaceId)
          .eq("id", String(row.id));
        continue;
      }
      const healedTitle = title ? cleanTopicTitle(title) : null;
      const meta =
        typeof row.metadata === "object" && row.metadata && !Array.isArray(row.metadata)
          ? ({ ...(row.metadata as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const rawDescription = meta.description ? String(meta.description) : "";
      const healedDescription = healedTitle
        ? cleanTopicDescription(rawDescription || undefined, healedTitle)
        : rawDescription;
      const needsHeal =
        Boolean(healedTitle && title !== healedTitle) ||
        Boolean(healedTitle && rawDescription && rawDescription !== healedDescription);
      if (needsHeal && healedTitle) {
        meta.description = healedDescription;
        await client
          .from("topic_suggestions")
          .update({ title: healedTitle, metadata: meta })
          .eq("workspace_id", workspaceId)
          .eq("id", String(row.id));
        row.title = healedTitle;
        row.metadata = meta;
      }
      usable.push(row);
    }

    return NextResponse.json({ suggestions: usable });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic-suggestions GET]", error);
    return NextResponse.json({ error: "Unable to load topic suggestions." }, { status: 500 });
  }
}
