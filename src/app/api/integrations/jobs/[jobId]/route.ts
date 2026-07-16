import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { getIntegrationJob } from "@/lib/integrations/jobs/queue";
import { processIntegrationJob } from "@/lib/integrations/jobs/worker";
import { reconcileChatArtifactsForJob } from "@/lib/integrations/jobs/reconcile-message-for-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);

    // RLS limits visibility to the caller's workspaces.
    const { data, error } = await client
      .from("integration_jobs")
      .select("workspace_id")
      .eq("id", params.jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const workspaceId = String(data.workspace_id);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    // Poll-driven worker nudge: a queued/due job gets processed on read.
    let job = await getIntegrationJob(client, workspaceId, params.jobId);
    if (job?.status === "queued") {
      const processed = await processIntegrationJob(client, workspaceId, job.id);
      if (processed) job = processed;
    } else if (
      job &&
      (job.status === "success" || job.status === "failed" || job.status === "cancelled")
    ) {
      // Heal stuck "Generating…" chips when the job already finished.
      await reconcileChatArtifactsForJob(client, job).catch(() => undefined);
    }

    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ integrations jobs GET]", error);
    return NextResponse.json({ error: "Unable to load job." }, { status: 500 });
  }
}
