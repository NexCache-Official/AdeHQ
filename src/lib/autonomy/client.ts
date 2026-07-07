// ===========================================================================
// Autonomy client — browser fetch helpers. Imports only types (no server code).
// ===========================================================================

import { authHeaders } from "@/lib/api/auth-client";
import { parseJsonResponse } from "@/lib/api/parse-json-response";
import type { AutonomousSession, AutonomousSessionStep } from "./types";

export type SessionPayload = { session: AutonomousSession; steps: AutonomousSessionStep[] };

export async function startAutonomousSession(input: {
  workspaceId: string;
  employeeId: string;
  objective: string;
  roomId?: string;
  topicId?: string;
  taskId?: string;
  stepBudget?: number;
  costBudgetUsd?: number;
}): Promise<SessionPayload> {
  const res = await fetch("/api/autonomy/sessions", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<SessionPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? "Could not start autonomous work.");
  return data;
}

export async function pollAutonomousSession(sessionId: string): Promise<SessionPayload> {
  const res = await fetch(`/api/autonomy/sessions/${sessionId}`, {
    method: "GET",
    headers: await authHeaders(),
  });
  const data = await parseJsonResponse<SessionPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? "Could not load session.");
  return data;
}

export async function controlAutonomousSession(
  sessionId: string,
  action: "stop" | "pause" | "resume",
): Promise<SessionPayload> {
  const res = await fetch(`/api/autonomy/sessions/${sessionId}/control`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action }),
  });
  const data = await parseJsonResponse<SessionPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? "Could not control session.");
  return data;
}

export const AUTONOMY_ACTIVE_STATUSES = new Set([
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "paused",
]);
