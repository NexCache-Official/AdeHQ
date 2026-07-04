import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import type { DriveSection } from "@/lib/drive/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEM_TYPES = new Set(["file", "artifact", "evidence", "export"]);

export async function PATCH(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as {
      workspaceId?: string;
      itemType?: string;
      itemId?: string;
      folderId?: string | null;
    };

    const workspaceId = String(body.workspaceId ?? "");
    const itemType = String(body.itemType ?? "");
    const itemId = String(body.itemId ?? "");
    const folderId = body.folderId ?? null;

    if (!workspaceId || !itemId || !ITEM_TYPES.has(itemType)) {
      return NextResponse.json({ error: "workspaceId, itemType, and itemId are required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    if (folderId) {
      const sectionForType: DriveSection =
        itemType === "artifact"
          ? "artifacts"
          : itemType === "evidence"
            ? "evidence"
            : itemType === "export"
              ? "exports"
              : "files";

      const { data: folder, error: folderError } = await client
        .from("drive_folders")
        .select("id, section")
        .eq("workspace_id", workspaceId)
        .eq("id", folderId)
        .maybeSingle();
      if (folderError) throw folderError;
      if (!folder) {
        return NextResponse.json({ error: "Destination folder not found." }, { status: 404 });
      }
      if (String(folder.section) !== sectionForType) {
        return NextResponse.json({ error: "Item type does not match folder section." }, { status: 400 });
      }
    }

    if (itemType === "file") {
      const { error } = await client
        .from("workspace_files")
        .update({ drive_folder_id: folderId })
        .eq("workspace_id", workspaceId)
        .eq("id", itemId);
      if (error) throw error;
    } else if (itemType === "artifact") {
      const { error } = await client
        .from("artifacts")
        .update({ drive_folder_id: folderId })
        .eq("workspace_id", workspaceId)
        .eq("id", itemId);
      if (error) throw error;
    } else if (itemType === "evidence") {
      const { error } = await client
        .from("browser_evidence")
        .update({ drive_folder_id: folderId })
        .eq("workspace_id", workspaceId)
        .eq("id", itemId);
      if (error) throw error;
    } else {
      const { error } = await client
        .from("drive_exports")
        .update({ drive_folder_id: folderId })
        .eq("workspace_id", workspaceId)
        .eq("id", itemId);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true, itemType, itemId, folderId });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive move]", error);
    return NextResponse.json({ error: "Unable to move item." }, { status: 500 });
  }
}
