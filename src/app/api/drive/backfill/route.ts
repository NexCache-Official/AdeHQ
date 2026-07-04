import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { backfillArtifactStorage } from "@/lib/drive/storage-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const workspaceId = String(body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId") ?? "");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);
    const synced = await backfillArtifactStorage(client, workspaceId, user.id, 50);

    return NextResponse.json({ synced });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive backfill]", error);
    return NextResponse.json({ error: "Unable to sync artifacts to storage." }, { status: 500 });
  }
}
