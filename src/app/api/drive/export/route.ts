import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { artifactFromRow } from "@/lib/files/records";
import { exportArtifactToDrive } from "@/lib/drive/storage-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as {
      workspaceId?: string;
      artifactId?: string;
      folderId?: string | null;
    };

    const workspaceId = String(body.workspaceId ?? "");
    const artifactId = String(body.artifactId ?? "");

    if (!workspaceId || !artifactId) {
      return NextResponse.json({ error: "workspaceId and artifactId are required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);

    const { data, error } = await client
      .from("artifacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", artifactId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });

    const artifact = artifactFromRow(data as Record<string, unknown>);
    const result = await exportArtifactToDrive(client, {
      workspaceId,
      userId: user.id,
      artifact,
      folderId: body.folderId ?? null,
    });

    return NextResponse.json({
      exportId: result.exportId,
      signedUrl: result.signedUrl,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ drive export]", error);
    return NextResponse.json({ error: "Unable to export artifact." }, { status: 500 });
  }
}
