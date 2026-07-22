import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function average(values: number[]) {
  if (!values.length) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const [{ data: calls, error: callsError }, { data: events, error: eventsError }] =
      await Promise.all([
        service
          .from("call_sessions")
          .select("id, status, created_at, answered_at, started_at")
          .eq("workspace_id", workspaceId)
          .gte("created_at", since),
        service
          .from("call_events")
          .select("event_type, payload")
          .eq("workspace_id", workspaceId)
          .gte("created_at", since)
          .like("event_type", "call.telemetry.%"),
      ]);
    if (callsError) throw callsError;
    if (eventsError) throw eventsError;

    const rows = calls ?? [];
    const accepted = rows.filter((call) => call.answered_at);
    const connected = rows.filter((call) => call.started_at);
    const dropped = rows.filter((call) => call.status === "failed");
    const acceptTimes = accepted.map(
      (call) =>
        new Date(String(call.answered_at)).getTime() - new Date(String(call.created_at)).getTime(),
    );
    const firstAudioTimes = (events ?? [])
      .map((event) => Number((event.payload as { timeToFirstAudioMs?: number })?.timeToFirstAudioMs))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const reconnects = (events ?? []).filter(
      (event) => event.event_type === "call.telemetry.reconnected",
    ).length;
    const reconnectDrops = (events ?? []).filter(
      (event) => event.event_type === "call.telemetry.dropped",
    ).length;

    return NextResponse.json({
      periodDays: 30,
      totalCalls: rows.length,
      connectionSuccessRate: rows.length ? connected.length / rows.length : null,
      callDropRate: connected.length ? dropped.length / connected.length : null,
      reconnectSuccessRate:
        reconnects + reconnectDrops ? reconnects / (reconnects + reconnectDrops) : null,
      averageTimeToAcceptMs: average(acceptTimes),
      averageTimeToFirstAudioMs: average(firstAudioTimes),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load call metrics." }, { status: 500 });
  }
}
