import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function durationMs(start?: string | null, finish?: string | null): number | null {
  if (!start || !finish) return null;
  const value = Date.parse(finish) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    if (role !== "admin") throw new AuthError("Admin access required.", 403);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
      .from("call_turns")
      .select(
        "human_ended_at, first_transcript_at, brain_started_at, first_text_token_at, first_audio_at, completed_at, stt_wh, brain_wh, tts_wh, interrupted, state, metadata",
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .limit(1000);
    if (error) throw error;
    const rows = (data ?? []).filter(
      (row) => (row.metadata as { used_tools?: boolean } | null)?.used_tools !== true,
    );
    const sttLatency = rows
      .map((row) => durationMs(row.human_ended_at, row.first_transcript_at))
      .filter((value): value is number => value != null);
    const brainLatency = rows
      .map((row) => durationMs(row.brain_started_at, row.first_text_token_at))
      .filter((value): value is number => value != null);
    const stopToAudio = rows
      .map((row) => durationMs(row.human_ended_at, row.first_audio_at))
      .filter((value): value is number => value != null);
    const totalWh = rows.reduce(
      (sum, row) =>
        sum + Number(row.stt_wh ?? 0) + Number(row.brain_wh ?? 0) + Number(row.tts_wh ?? 0),
      0,
    );
    return NextResponse.json({
      windowDays: 7,
      turns: rows.length,
      latencyMs: {
        speechToTranscript: { p50: percentile(sttLatency, 0.5), p95: percentile(sttLatency, 0.95) },
        transcriptToBrainToken: { p50: percentile(brainLatency, 0.5), p95: percentile(brainLatency, 0.95) },
        speechToFirstAudio: { p50: percentile(stopToAudio, 0.5), p95: percentile(stopToAudio, 0.95) },
      },
      interruptedTurns: rows.filter((row) => row.interrupted).length,
      failedTurns: rows.filter((row) => row.state === "failed").length,
      totalWh,
      targets: {
        speechToTranscriptP50: 700,
        speechToTranscriptP95: 1500,
        transcriptToBrainTokenP50: 1500,
        speechToFirstAudioP50: 2500,
        speechToFirstAudioP95: 5000,
        bargeInStopP95: 250,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load call metrics." }, { status: 500 });
  }
}
