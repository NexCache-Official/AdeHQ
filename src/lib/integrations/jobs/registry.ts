// ===========================================================================
// Job handler registry — separate module to avoid circular imports between
// worker.ts and artifact-handlers.ts.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord } from "@/lib/integrations/types";

export type JobHandlerResult = {
  result: Record<string, unknown>;
  costUsd?: number;
  summary?: string;
};

export type JobHandler = (
  client: SupabaseClient,
  job: IntegrationJobRecord,
) => Promise<JobHandlerResult>;

const JOB_HANDLERS: Record<string, JobHandler> = {
  noop: async () => ({ result: { ok: true }, costUsd: 0 }),
};

export function registerJobHandler(jobType: string, handler: JobHandler): void {
  JOB_HANDLERS[jobType] = handler;
}

export function getJobHandler(jobType: string): JobHandler | undefined {
  return JOB_HANDLERS[jobType];
}
