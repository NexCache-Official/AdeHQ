import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { clearRoomChatHistory } from "@/lib/server/clear-chat-history";
import { loadRoom } from "@/lib/server/room-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    const room = await loadRoom(client, workspaceId, params.roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const isAdmin = role === "owner" || role === "admin";
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only workspace admins can clear all chat history in a room." },
        { status: 403 },
      );
    }

    const result = await clearRoomChatHistory(
      createServiceRoleClient(),
      workspaceId,
      params.roomId,
    );
    return NextResponse.json({ ...result, cleared: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ room clear-chat]", error);
    return NextResponse.json({ error: "Unable to clear room chat history." }, { status: 500 });
  }
}
