/**
 * Idempotent email_jobs with leases. Cron + best-effort drain reclaim stale locks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEASE_MINUTES, type EmailJobType } from "./types";

export async function enqueueEmailJob(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    threadId?: string | null;
    messageId?: string | null;
    draftId?: string | null;
    jobType: EmailJobType;
    idempotencyKey: string;
    payload?: Record<string, unknown>;
    availableAt?: string;
  },
): Promise<{ jobId: string; deduped: boolean }> {
  const { data: existing } = await client
    .from("email_jobs")
    .select("id, status")
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (existing) {
    return { jobId: String(existing.id), deduped: true };
  }

  const { data, error } = await client
    .from("email_jobs")
    .insert({
      workspace_id: params.workspaceId,
      mailbox_id: params.mailboxId,
      thread_id: params.threadId ?? null,
      message_id: params.messageId ?? null,
      draft_id: params.draftId ?? null,
      job_type: params.jobType,
      idempotency_key: params.idempotencyKey,
      status: "queued",
      payload: params.payload ?? {},
      available_at: params.availableAt ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: again } = await client
        .from("email_jobs")
        .select("id")
        .eq("idempotency_key", params.idempotencyKey)
        .maybeSingle();
      if (again) return { jobId: String(again.id), deduped: true };
    }
    throw error;
  }

  return { jobId: String(data.id), deduped: false };
}

export async function reclaimExpiredLeases(
  client: SupabaseClient,
  leaseMinutes = LEASE_MINUTES,
): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMinutes * 60_000).toISOString();
  const { data, error } = await client
    .from("email_jobs")
    .update({
      status: "queued",
      locked_at: null,
      locked_by: null,
      available_at: new Date().toISOString(),
      last_error: "lease_expired",
    })
    .eq("status", "running")
    .lt("locked_at", cutoff)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function claimNextJobs(
  client: SupabaseClient,
  limit: number,
  workerId: string,
): Promise<Array<Record<string, unknown>>> {
  await reclaimExpiredLeases(client);

  const { data: candidates, error } = await client
    .from("email_jobs")
    .select("*")
    .eq("status", "queued")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const claimed: Array<Record<string, unknown>> = [];
  for (const row of candidates ?? []) {
    const { data, error: claimErr } = await client
      .from("email_jobs")
      .update({
        status: "running",
        locked_at: new Date().toISOString(),
        locked_by: workerId,
        attempt_count: Number(row.attempt_count ?? 0) + 1,
      })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (data) claimed.push(data);
  }
  return claimed;
}

export async function completeJob(
  client: SupabaseClient,
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await client
    .from("email_jobs")
    .update({
      status: "completed",
      result,
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
    })
    .eq("id", jobId);
}

export async function failJob(
  client: SupabaseClient,
  jobId: string,
  errorMessage: string,
  opts?: { attemptCount?: number; maxAttempts?: number },
): Promise<"failed" | "requeued"> {
  const attempts = opts?.attemptCount ?? 1;
  const maxAttempts = opts?.maxAttempts ?? 3;
  if (attempts < maxAttempts) {
    const backoffMs = Math.min(15 * 60_000, attempts * 60_000);
    await client
      .from("email_jobs")
      .update({
        status: "queued",
        last_error: errorMessage.slice(0, 1000),
        locked_at: null,
        locked_by: null,
        available_at: new Date(Date.now() + backoffMs).toISOString(),
        completed_at: null,
      })
      .eq("id", jobId);
    return "requeued";
  }
  await client
    .from("email_jobs")
    .update({
      status: "failed",
      last_error: errorMessage.slice(0, 1000),
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", jobId);
  return "failed";
}

export async function cancelJob(
  client: SupabaseClient,
  params: { jobId: string; mailboxId: string },
): Promise<boolean> {
  const { data, error } = await client
    .from("email_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", params.jobId)
    .eq("mailbox_id", params.mailboxId)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function countRecentJobs(
  client: SupabaseClient,
  params: {
    mailboxId: string;
    jobType: EmailJobType;
    sinceIso: string;
    userId?: string;
  },
): Promise<number> {
  let q = client
    .from("email_jobs")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_id", params.mailboxId)
    .eq("job_type", params.jobType)
    .gte("created_at", params.sinceIso);
  if (params.userId) {
    q = q.contains("payload", { requestedBy: params.userId });
  }
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function countConcurrentJobs(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { count, error } = await client
    .from("email_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("status", ["queued", "running"]);
  if (error) throw error;
  return count ?? 0;
}
