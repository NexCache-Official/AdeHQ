import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import {
  permanentlyDeleteRoom,
  roomFromRow,
  loadRoom,
} from "@/lib/server/room-helpers";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchRoomBody = {
  status?: "active" | "archived";
  name?: string;
  description?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const room = await loadRoom(client, workspaceId, params.roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    if (room.kind === "dm") {
      return NextResponse.json({ error: "Direct messages cannot be archived." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    const isAdmin = role === "owner" || role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Only workspace admins can update rooms." }, { status: 403 });
    }

    const body = (await request.json()) as PatchRoomBody;
    const patch: Record<string, unknown> = { updated_at: nowISO() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description?.trim() ?? "";
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await client
      .from("rooms")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("id", params.roomId)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ room: roomFromRow(data as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ room PATCH]", error);
    return NextResponse.json({ error: "Unable to update room." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const room = await loadRoom(client, workspaceId, params.roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    if (room.kind === "dm") {
      return NextResponse.json({ error: "Direct messages cannot be deleted here." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    const isAdmin = role === "owner" || role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Only workspace admins can delete rooms." }, { status: 403 });
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanent) {
      await permanentlyDeleteRoom(client, workspaceId, params.roomId);
      return NextResponse.json({ deleted: true, roomId: params.roomId });
    }

    const { data, error } = await client
      .from("rooms")
      .update({ status: "archived", updated_at: nowISO() })
      .eq("workspace_id", workspaceId)
      .eq("id", params.roomId)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ room: roomFromRow(data as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ room DELETE]", error);
    const message = error instanceof Error ? error.message : "Unable to delete room.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
