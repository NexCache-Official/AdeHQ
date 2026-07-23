import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  nextNumberedDisplayName,
  type DriveNameConflict,
} from "@/lib/drive/duplicate-names";
import { sanitizeFileName } from "@/lib/files/sanitize-file-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  workspaceId?: string;
  folderId?: string | null;
  names?: string[];
};

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as Body;
    const workspaceId = String(body.workspaceId ?? "");
    const folderId = body.folderId ? String(body.folderId) : null;
    const names = Array.isArray(body.names) ? body.names.map(String).filter(Boolean) : [];

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!names.length) {
      return NextResponse.json({ conflicts: [] as DriveNameConflict[] });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    let query = client
      .from("workspace_files")
      .select("id, display_name, original_name")
      .eq("workspace_id", workspaceId)
      .eq("drive_section", "files");
    query = folderId ? query.eq("drive_folder_id", folderId) : query.is("drive_folder_id", null);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      display_name: string;
      original_name: string;
    }>;
    const byDisplay = new Map<string, { id: string; displayName: string }>();
    const allNames = rows.map((row) => String(row.display_name));
    for (const row of rows) {
      byDisplay.set(sanitizeFileName(String(row.display_name)).toLowerCase(), {
        id: String(row.id),
        displayName: String(row.display_name),
      });
    }

    const conflicts: DriveNameConflict[] = [];
    const reserved = new Set(allNames.map((name) => sanitizeFileName(name).toLowerCase()));
    /** First upload in this batch that claimed a display name (for within-batch dupes). */
    const claimedInBatch = new Map<string, { originalName: string; displayName: string }>();

    for (const originalName of names) {
      const displayName = sanitizeFileName(originalName);
      const key = displayName.toLowerCase();
      const existing = byDisplay.get(key);
      const priorInBatch = claimedInBatch.get(key);

      if (!existing && !priorInBatch) {
        reserved.add(key);
        claimedInBatch.set(key, { originalName, displayName });
        continue;
      }

      const suggestedName = nextNumberedDisplayName(displayName, reserved);
      reserved.add(suggestedName.toLowerCase());
      conflicts.push({
        originalName,
        displayName,
        existingFileId: existing?.id ?? "",
        existingDisplayName: existing?.displayName ?? priorInBatch?.displayName ?? displayName,
        suggestedName,
      });
      // Later keep-both names also reserve; replace only applies when existingFileId is set.
    }

    return NextResponse.json({ conflicts });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive upload conflicts]", error);
    return NextResponse.json({ error: "Unable to check for duplicate files." }, { status: 500 });
  }
}
