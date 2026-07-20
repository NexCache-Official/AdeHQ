import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function durationMs(start?: string | null, finish?: string | null): number | null {
  if (!start || !finish) return null;
  const value = Date.parse(finish) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue));
  return sorted[index];
}

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await serviceClient
    .from("call_turns")
    .select(
      "workspace_id, human_ended_at, first_transcript_at, brain_started_at, first_text_token_at, first_audio_at, stt_wh, brain_wh, tts_wh, interrupted, state, metadata",
    )
    .gte("created_at", since)
    .limit(5000);
  if (error) throw error;

  const rows = (data ?? []).filter(
    (row) => (row.metadata as { used_tools?: boolean } | null)?.used_tools !== true,
  );
  const sttLatency = rows.flatMap((row) => {
    const value = durationMs(row.human_ended_at, row.first_transcript_at);
    return value == null ? [] : [value];
  });
  const brainLatency = rows.flatMap((row) => {
    const value = durationMs(row.brain_started_at, row.first_text_token_at);
    return value == null ? [] : [value];
  });
  const stopToAudio = rows.flatMap((row) => {
    const value = durationMs(row.human_ended_at, row.first_audio_at);
    return value == null ? [] : [value];
  });

  return NextResponse.json({
    windowDays: 7,
    turns: rows.length,
    workspaces: new Set(rows.map((row) => row.workspace_id)).size,
    latencyMs: {
      speechToTranscript: {
        p50: percentile(sttLatency, 0.5),
        p95: percentile(sttLatency, 0.95),
      },
      transcriptToBrainToken: {
        p50: percentile(brainLatency, 0.5),
        p95: percentile(brainLatency, 0.95),
      },
      speechToFirstAudio: {
        p50: percentile(stopToAudio, 0.5),
        p95: percentile(stopToAudio, 0.95),
      },
    },
    interruptedTurns: rows.filter((row) => row.interrupted).length,
    failedTurns: rows.filter((row) => row.state === "failed").length,
    totalWh: rows.reduce(
      (sum, row) =>
        sum + Number(row.stt_wh ?? 0) + Number(row.brain_wh ?? 0) + Number(row.tts_wh ?? 0),
      0,
    ),
    targets: {
      speechToTranscript: { p50: 700, p95: 1500 },
      transcriptToBrainToken: { p50: 1500 },
      speechToFirstAudio: { p50: 2500, p95: 5000 },
    },
  });
});
