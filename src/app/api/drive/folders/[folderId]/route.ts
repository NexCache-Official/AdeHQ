import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { driveFolderFromRow } from "@/lib/drive/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadFolder(
  client: Awaited<ReturnType<typeof requireAuthUser>>["client"],
  workspaceId: string,
  folderId: string,
) {
  const { data, error } = await client
    .from("drive_folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", folderId)
    .maybeSingle();
  if (error) throw error;
  return data ? driveFolderFromRow(data as Record<string, unknown>) : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { folderId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as { workspaceId?: string; name?: string };
    const workspaceId = String(body.workspaceId ?? "");
    const name = String(body.name ?? "").trim();

    if (!workspaceId || !name) {
      return NextResponse.json({ error: "workspaceId and name are required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);
    const existing = await loadFolder(client, workspaceId, params.folderId);
    if (!existing) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }

    const { data, error } = await client
      .from("drive_folders")
      .update({ name })
      .eq("workspace_id", workspaceId)
      .eq("id", params.folderId)
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "A folder with that name already exists here." }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ folder: driveFolderFromRow(data as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive folder PATCH]", error);
    return NextResponse.json({ error: "Unable to rename folder." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { folderId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);
    const existing = await loadFolder(client, workspaceId, params.folderId);
    if (!existing) {
      return NextResponse.json({ error: "Folder not found." }, { status: 404 });
    }

    const [childFolders, childFiles] = await Promise.all([
      client
        .from("drive_folders")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("parent_id", params.folderId),
      client
        .from("workspace_files")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("drive_folder_id", params.folderId)
        .neq("status", "failed"),
    ]);
    if (childFolders.error) throw childFolders.error;
    if (childFiles.error) throw childFiles.error;

    if ((childFolders.count ?? 0) > 0 || (childFiles.count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Remove or move items out of this folder before deleting it." },
        { status: 409 },
      );
    }

    const { error } = await client
      .from("drive_folders")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", params.folderId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive folder DELETE]", error);
    return NextResponse.json({ error: "Unable to delete folder." }, { status: 500 });
  }
}
