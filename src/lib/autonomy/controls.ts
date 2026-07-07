// ===========================================================================
// Autonomy controls — human stop / pause / resume for a running session.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "@/lib/utils";
import { appendStep, getSession, listSteps, updateSession } from "./session-store";
import type { AutonomousSession } from "./types";

const ACTIVE = new Set(["queued", "planning", "running", "waiting_approval", "paused"]);

export async function requestStop(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomousSession | null> {
  const session = await getSession(client, sessionId);
  if (!session || !ACTIVE.has(session.status)) return session;

  const seq = (await listSteps(client, sessionId)).length;
  await appendStep(client, {
    workspaceId: session.workspaceId,
    sessionId,
    seq,
    kind: "status",
    title: "Stop requested",
    detail: "A teammate asked the employee to stop.",
    metadata: { iteration: session.stepsUsed },
  });

  // If not mid-iteration, mark stopped immediately; otherwise the next
  // iteration observes stop_requested and finalizes cleanly.
  if (session.status === "running") {
    return updateSession(client, sessionId, { stopRequested: true });
  }
  return updateSession(client, sessionId, {
    status: "stopped",
    stopRequested: true,
    resultSummary: session.resultSummary ?? "Stopped before finishing.",
    completedAt: nowISO(),
  });
}

export async function pauseSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomousSession | null> {
  const session = await getSession(client, sessionId);
  if (!session) return null;
  if (!["queued", "running"].includes(session.status)) return session;
  return updateSession(client, sessionId, { status: "paused" });
}

export async function resumeSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomousSession | null> {
  const session = await getSession(client, sessionId);
  if (!session) return null;
  if (session.status !== "paused") return session;
  return updateSession(client, sessionId, { status: "queued" });
}
