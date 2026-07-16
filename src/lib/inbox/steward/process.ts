/**
 * Process claimed email_jobs (triage / draft / rewrite).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { claimNextJobs, completeJob, failJob } from "./jobs";
import { runTriageForMessage } from "./run";
import { runDraftJob } from "./draft";
import { wakeEmployeeForEmailThread } from "./inbound-wake";

export async function processEmailJobs(
  client: SupabaseClient,
  limit = 5,
): Promise<number> {
  const workerId = `email-jobs-${process.pid}-${Date.now()}`;
  const claimed = await claimNextJobs(client, limit, workerId);
  let n = 0;
  for (const job of claimed) {
    const jobId = String(job.id);
    const jobType = String(job.job_type);
    try {
      if (jobType === "triage") {
        await runTriageForMessage(client, {
          workspaceId: String(job.workspace_id),
          mailboxId: String(job.mailbox_id),
          threadId: String(job.thread_id),
          messageId: String(job.message_id),
          jobId,
        });
        await completeJob(client, jobId, { ok: true });
      } else if (jobType === "draft" || jobType === "rewrite") {
        await runDraftJob(client, job);
        await completeJob(client, jobId, { ok: true });
      } else if (jobType === "inbound_wake") {
        const payload = (job.payload as Record<string, unknown> | null) ?? {};
        const result = await wakeEmployeeForEmailThread(client, {
          workspaceId: String(job.workspace_id),
          mailboxId: String(job.mailbox_id),
          threadId: String(job.thread_id),
          messageId: String(job.message_id),
          employeeId: String(payload.employeeId ?? ""),
        });
        await completeJob(client, jobId, { ok: true, wake: result });
      } else {
        await failJob(client, jobId, `unknown_job_type:${jobType}`);
      }
      n += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await failJob(client, jobId, message, {
        attemptCount: Number(job.attempt_count ?? 1),
        maxAttempts: 3,
      });
      if (outcome === "failed" && (jobType === "draft" || jobType === "rewrite")) {
        const threadId = job.thread_id ? String(job.thread_id) : null;
        if (threadId) {
          await client
            .from("email_threads")
            .update({ draft_status: "failed" })
            .eq("id", threadId);
        }
      }
    }
  }
  // Triage can enqueue an inbound_wake job. Drain newly-created follow-up work
  // in the same best-effort nudge without exceeding the caller's batch limit.
  if (claimed.length > 0 && n < limit) {
    return n + (await processEmailJobs(client, limit - n));
  }
  return n;
}
