import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import type { DriveSection } from "@/lib/drive/constants";
import { driveFolderFromRow } from "@/lib/drive/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTIONS = new Set<DriveSection>(["files", "artifacts", "evidence", "exports"]);

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as {
      workspaceId?: string;
      name?: string;
      section?: DriveSection;
      parentId?: string | null;
    };

    const workspaceId = String(body.workspaceId ?? "");
    const name = String(body.name ?? "").trim();
    const section = body.section ?? "files";

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "Folder name is required." }, { status: 400 });
    }
    if (!SECTIONS.has(section)) {
      return NextResponse.json({ error: "Invalid section." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    if (body.parentId) {
      const { data: parent, error: parentError } = await client
        .from("drive_folders")
        .select("id, section")
        .eq("workspace_id", workspaceId)
        .eq("id", body.parentId)
        .maybeSingle();
      if (parentError) throw parentError;
      if (!parent) {
        return NextResponse.json({ error: "Parent folder not found." }, { status: 404 });
      }
      if (String(parent.section) !== section) {
        return NextResponse.json({ error: "Parent folder section mismatch." }, { status: 400 });
      }
    }

    const { data, error } = await client
      .from("drive_folders")
      .insert({
        workspace_id: workspaceId,
        parent_id: body.parentId ?? null,
        name,
        section,
        created_by_user_id: user.id,
      })
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
    console.error("[AdeHQ drive folders POST]", error);
    return NextResponse.json({ error: "Unable to create folder." }, { status: 500 });
  }
}
