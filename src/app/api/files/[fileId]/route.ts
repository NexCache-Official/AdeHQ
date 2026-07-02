import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { fileChunkFromRow, workspaceFileFromRow } from "@/lib/files/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadAccessibleFile(
  request: NextRequest,
  fileId: string,
) {
  const { user, client } = await requireAuthUser(request);
  const { data: row, error } = await client
    .from("workspace_files")
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new AuthError("File not found.", 404);

  const file = workspaceFileFromRow(row as Record<string, unknown>);
  const { role } = await requireWorkspaceMembership(client, file.workspaceId, user.id);
  if (file.roomId) {
    await assertCanAccessRoom(client, file.workspaceId, file.roomId, user.id, role);
  }
  return { user, client, file, role };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { fileId: string } },
) {
  try {
    const { client, file } = await loadAccessibleFile(request, params.fileId);

    const [chunksResult, signedUrlResult] = await Promise.all([
      client
        .from("file_chunks")
        .select("id, workspace_id, file_id, room_id, topic_id, chunk_index, content_preview, page_start, page_end, sheet_name, row_start, row_end, token_estimate, metadata, embedding_status, created_at")
        .eq("workspace_id", file.workspaceId)
        .eq("file_id", file.id)
        .order("chunk_index", { ascending: true })
        .limit(50),
      client.storage.from(file.storageBucket).createSignedUrl(file.storagePath, 60 * 5),
    ]);
    if (chunksResult.error) throw chunksResult.error;

    return NextResponse.json({
      file,
      chunks: (chunksResult.data ?? []).map((row) => fileChunkFromRow(row as Record<string, unknown>)),
      signedUrl: signedUrlResult.data?.signedUrl ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ file GET]", error);
    return NextResponse.json({ error: "Unable to load file." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { fileId: string } },
) {
  try {
    const { user, client, file, role } = await loadAccessibleFile(request, params.fileId);
    const isAdmin = role === "owner" || role === "admin";
    if (!isAdmin && file.uploadedByUserId !== user.id) {
      return NextResponse.json({ error: "Only the uploader or a workspace admin can remove this file." }, { status: 403 });
    }

    const { error } = await client
      .from("workspace_files")
      .update({ status: "failed", error_message: "Removed by user" })
      .eq("workspace_id", file.workspaceId)
      .eq("id", file.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ file DELETE]", error);
    return NextResponse.json({ error: "Unable to remove file." }, { status: 500 });
  }
}
