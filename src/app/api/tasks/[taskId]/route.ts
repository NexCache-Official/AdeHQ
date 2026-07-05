import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadTaskRow(
  client: import("@supabase/supabase-js").SupabaseClient,
  taskId: string,
) {
  const { data, error } = await client
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const row = await loadTaskRow(client, params.taskId);
    if (!row) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    const workspaceId = String(row.workspace_id);
    const roomId = String(row.room_id);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, roomId, user.id, role);

    const { error } = await client
      .from("tasks")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", params.taskId);

    if (error) throw error;
    return NextResponse.json({ deleted: true, taskId: params.taskId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ task DELETE]", error);
    return NextResponse.json({ error: "Unable to delete task." }, { status: 500 });
  }
}
