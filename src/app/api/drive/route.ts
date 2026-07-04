import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import type { DriveSection } from "@/lib/drive/constants";
import { backfillArtifactStorage } from "@/lib/drive/storage-sync";
import { listDriveContents } from "@/lib/server/drive-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECTIONS = new Set<DriveSection | "all">(["all", "files", "artifacts", "evidence", "exports"]);

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
    const sectionParam = (request.nextUrl.searchParams.get("section") ?? "all") as DriveSection | "all";
    const folderId = request.nextUrl.searchParams.get("folderId");
    const query = request.nextUrl.searchParams.get("q") ?? undefined;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!SECTIONS.has(sectionParam)) {
      return NextResponse.json({ error: "Invalid section." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    await backfillArtifactStorage(client, workspaceId, user.id, 12).catch((err) =>
      console.warn("[AdeHQ drive GET] artifact backfill skipped", err),
    );

    const payload = await listDriveContents(client, {
      workspaceId,
      section: sectionParam,
      folderId: folderId || null,
      query,
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive GET]", error);
    return NextResponse.json({ error: "Unable to load AdeHQ Drive." }, { status: 500 });
  }
}
