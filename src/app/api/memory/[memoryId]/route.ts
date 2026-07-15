import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { memoryRowToEntry } from "@/lib/memory/build-entry";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { nowISO } from "@/lib/utils";
import type { MemoryStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadMemoryRow(
  client: import("@supabase/supabase-js").SupabaseClient,
  memoryId: string,
) {
  const { data, error } = await client
    .from("memory_entries")
    .select("*")
    .eq("id", memoryId)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

function canMutateMemory(role: string, userId: string, entry: ReturnType<typeof memoryRowToEntry>): boolean {
  if (role === "admin" || role === "owner") return true;
  return (
    entry.savedByUserId === userId ||
    entry.createdById === userId ||
    entry.suggestedById === userId
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { memoryId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const row = await loadMemoryRow(client, params.memoryId);
    if (!row) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 });
    }

    const workspaceId = String(row.workspace_id);
    const entry = memoryRowToEntry(row);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);

    if (entry.roomId) {
      await assertCanAccessRoom(client, workspaceId, entry.roomId, user.id, role);
    }

    if (!canMutateMemory(role, user.id, entry)) {
      return NextResponse.json({ error: "You cannot edit this memory." }, { status: 403 });
    }

    const body = (await request.json()) as {
      title?: string;
      content?: string;
      category?: string;
      tags?: string[];
      status?: MemoryStatus;
    };

    const patch: Record<string, unknown> = { updated_at: nowISO() };
    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.content !== undefined) patch.content = body.content.trim();
    if (body.category !== undefined) patch.category = body.category;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await client
      .from("memory_entries")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("id", params.memoryId)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ memory: memoryRowToEntry(data as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ memory PATCH]", error);
    return NextResponse.json({ error: "Unable to update memory." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { memoryId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const row = await loadMemoryRow(client, params.memoryId);
    if (!row) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 });
    }

    const workspaceId = String(row.workspace_id);
    const entry = memoryRowToEntry(row);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);

    if (entry.roomId) {
      await assertCanAccessRoom(client, workspaceId, entry.roomId, user.id, role);
    }

    if (!canMutateMemory(role, user.id, entry)) {
      return NextResponse.json({ error: "You cannot delete this memory." }, { status: 403 });
    }

    const { error } = await client
      .from("memory_entries")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", params.memoryId);

    if (error) throw error;
    return NextResponse.json({ deleted: true, memoryId: params.memoryId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ memory DELETE]", error);
    return NextResponse.json({ error: "Unable to delete memory." }, { status: 500 });
  }
}
