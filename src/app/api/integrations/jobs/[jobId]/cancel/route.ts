import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { getIntegrationJob } from "@/lib/integrations/jobs/queue";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Request cancellation of an async integration job (PR-17 video).
 * SiliconFlow has no public cancel endpoint — we stop polling and mark cancelled locally.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { data, error } = await client
      .from("integration_jobs")
      .select("workspace_id, status, payload, job_type")
      .eq("id", params.jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const workspaceId = String(data.workspace_id);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const status = String(data.status);
    if (status === "success" || status === "failed" || status === "cancelled") {
      const job = await getIntegrationJob(client, workspaceId, params.jobId);
      return NextResponse.json({ job, alreadyTerminal: true });
    }

    const prev = (data.payload ?? {}) as Record<string, unknown>;
    const nextPayload = {
      ...prev,
      cancelRequested: true,
      cancelRequestedAt: nowISO(),
      cancelRequestedBy: user.id,
    };

    // If still queued, flip to cancelled immediately. If running, flag for the poller.
    if (status === "queued") {
      await client
        .from("integration_jobs")
        .update({
          status: "cancelled",
          payload: nextPayload,
          completed_at: nowISO(),
          error_message: "Cancelled before execution started.",
        })
        .eq("workspace_id", workspaceId)
        .eq("id", params.jobId);
    } else {
      await client
        .from("integration_jobs")
        .update({
          payload: nextPayload,
          updated_at: nowISO(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", params.jobId);
    }

    const job = await getIntegrationJob(client, workspaceId, params.jobId);
    return NextResponse.json({ job, cancelRequested: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ integrations jobs cancel]", error);
    return NextResponse.json({ error: "Unable to cancel job." }, { status: 500 });
  }
}
