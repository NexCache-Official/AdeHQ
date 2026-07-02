import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { roomId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as { employeeId?: string };

    if (!body.employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);

    const { data: room, error: roomError } = await client
      .from("rooms")
      .select("kind, status")
      .eq("workspace_id", workspaceId)
      .eq("id", params.roomId)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }
    if (room.kind === "dm") {
      return NextResponse.json({ error: "Employees cannot be added to direct messages." }, { status: 400 });
    }
    if (room.status === "archived") {
      return NextResponse.json({ error: "This room is archived." }, { status: 400 });
    }

    const { data: employee, error: employeeError } = await client
      .from("ai_employees")
      .select("id, metadata")
      .eq("workspace_id", workspaceId)
      .eq("id", body.employeeId)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    const metadata = (employee.metadata ?? {}) as { canBeAssignedToRooms?: boolean };
    if (metadata.canBeAssignedToRooms === false) {
      return NextResponse.json({ error: "This employee cannot be assigned to rooms." }, { status: 400 });
    }

    const { data: existing } = await client
      .from("room_members")
      .select("member_id")
      .eq("workspace_id", workspaceId)
      .eq("room_id", params.roomId)
      .eq("member_type", "ai")
      .eq("member_id", body.employeeId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, alreadyMember: true });
    }

    const { error } = await client.from("room_members").insert({
      workspace_id: workspaceId,
      room_id: params.roomId,
      member_type: "ai",
      member_id: body.employeeId,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ room members POST]", error);
    return NextResponse.json({ error: "Unable to add room member." }, { status: 500 });
  }
}
