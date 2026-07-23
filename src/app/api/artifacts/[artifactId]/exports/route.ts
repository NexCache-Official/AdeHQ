import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { loadAccessibleArtifact } from "@/lib/artifacts/api-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List exports for an artifact — allowed even when export flag is OFF. */
export async function GET(
  request: NextRequest,
  { params }: { params: { artifactId: string } },
) {
  try {
    const { client, artifact } = await loadAccessibleArtifact(request, params.artifactId);
    const { data, error } = await client
      .from("artifact_exports")
      .select("*")
      .eq("artifact_id", artifact.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ ok: true, exports: data ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ artifact exports GET]", error);
    return NextResponse.json({ ok: false, error: "Unable to list exports." }, { status: 500 });
  }
}
