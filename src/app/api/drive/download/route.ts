import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { artifactFromRow, workspaceFileFromRow } from "@/lib/files/records";
import { browserEvidenceFromRow, driveExportFromRow } from "@/lib/server/drive-list";
import { createSignedDriveUrl } from "@/lib/drive/storage-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
    const itemType = request.nextUrl.searchParams.get("type") ?? "";
    const itemId = request.nextUrl.searchParams.get("id") ?? "";

    if (!workspaceId || !itemId) {
      return NextResponse.json({ error: "workspaceId and id are required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    if (itemType === "file") {
      const { data, error } = await client
        .from("workspace_files")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", itemId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "File not found." }, { status: 404 });
      const file = workspaceFileFromRow(data as Record<string, unknown>);
      const signedUrl = await createSignedDriveUrl(client, file.storageBucket, file.storagePath);
      return NextResponse.json({
        itemType: "file",
        item: file,
        signedUrl,
        previewText: file.textPreview ?? file.extractedText?.slice(0, 4000) ?? null,
      });
    }

    if (itemType === "artifact") {
      const { data, error } = await client
        .from("artifacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", itemId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
      const artifact = artifactFromRow(data as Record<string, unknown>);
      const storagePath =
        typeof artifact.metadata?.storagePath === "string" ? artifact.metadata.storagePath : null;
      const storageBucket =
        typeof artifact.metadata?.storageBucket === "string"
          ? artifact.metadata.storageBucket
          : null;
      const signedUrl =
        storagePath && storageBucket
          ? await createSignedDriveUrl(client, storageBucket, storagePath)
          : null;
      return NextResponse.json({
        itemType: "artifact",
        item: artifact,
        signedUrl,
        previewText: artifact.contentMarkdown.slice(0, 4000),
      });
    }

    if (itemType === "evidence") {
      const { data, error } = await client
        .from("browser_evidence")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", itemId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Evidence not found." }, { status: 404 });
      const evidence = browserEvidenceFromRow(data as Record<string, unknown>);
      const signedUrl = await createSignedDriveUrl(
        client,
        evidence.storageBucket,
        evidence.storagePath,
      );
      return NextResponse.json({ itemType: "evidence", item: evidence, signedUrl });
    }

    if (itemType === "export") {
      const { data, error } = await client
        .from("drive_exports")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", itemId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Export not found." }, { status: 404 });
      const driveExport = driveExportFromRow(data as Record<string, unknown>);
      const signedUrl = await createSignedDriveUrl(
        client,
        driveExport.storageBucket,
        driveExport.storagePath,
      );
      return NextResponse.json({ itemType: "export", item: driveExport, signedUrl });
    }

    return NextResponse.json({ error: "Unsupported type." }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive download]", error);
    return NextResponse.json({ error: "Unable to get download link." }, { status: 500 });
  }
}
