import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT } from "./helpers";

export type JobSummary = {
  pricingSync: { pending: number; running: number; failed: number; completed: number };
  agentRuns: { queued: number; running: number; failed: number; completed: number };
  browserRuns: { running: number; failed: number; completed: number };
  recentJobs: {
    id: string;
    jobType: string;
    status: string;
    lastError: string | null;
    createdAt: string;
  }[];
};

export async function getJobsSummary(client: SupabaseClient): Promise<JobSummary> {
  const [syncRes, agentRes, browserRes, jobEventsRes] = await Promise.all([
    client
      .from("ai_model_sync_runs")
      .select("status")
      .order("started_at", { ascending: false })
      .limit(200),
    client
      .from("agent_runs")
      .select("status")
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("browser_research_runs")
      .select("status")
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("platform_job_events")
      .select("id, job_type, status, last_error, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  for (const res of [syncRes, agentRes, browserRes, jobEventsRes]) {
    if (res.error) throw res.error;
  }

  const countStatus = (rows: { status: string }[] | null, status: string) =>
    (rows ?? []).filter((r) => r.status === status).length;

  const syncRows = syncRes.data ?? [];
  const agentRows = agentRes.data ?? [];
  const browserRows = browserRes.data ?? [];

  return {
    pricingSync: {
      pending: countStatus(syncRows, "started"),
      running: countStatus(syncRows, "started"),
      failed: countStatus(syncRows, "failed"),
      completed: countStatus(syncRows, "success"),
    },
    agentRuns: {
      queued: countStatus(agentRows, "queued"),
      running: countStatus(agentRows, "running"),
      failed: countStatus(agentRows, "failed"),
      completed: countStatus(agentRows, "completed"),
    },
    browserRuns: {
      running: countStatus(browserRows, "running"),
      failed: countStatus(browserRows, "failed"),
      completed: countStatus(browserRows, "completed"),
    },
    recentJobs: (jobEventsRes.data ?? []).map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      lastError: row.last_error,
      createdAt: row.created_at,
    })),
  };
}
