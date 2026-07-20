"use client";

import { AdminAsync, AdminHealthBadge, AdminMetricCard, useAdminData } from "./common";
import { Card } from "@/components/ui";

type LatencyPair = { p50: number | null; p95?: number | null };

type LiveCallMetrics = {
  windowDays: number;
  turns: number;
  workspaces: number;
  latencyMs: {
    speechToTranscript: LatencyPair;
    transcriptToBrainToken: LatencyPair;
    speechToFirstAudio: LatencyPair;
  };
  interruptedTurns: number;
  failedTurns: number;
  totalWh: number;
  targets: {
    speechToTranscript: { p50: number; p95: number };
    transcriptToBrainToken: { p50: number };
    speechToFirstAudio: { p50: number; p95: number };
  };
};

function formatLatency(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value)} ms`;
}

function meetsTarget(value: number | null | undefined, target: number): boolean | null {
  return value == null ? null : value <= target;
}

export function LiveCallMetricsPanel() {
  const { data, loading, error } = useAdminData<LiveCallMetrics>("/api/admin/call-metrics");
  const gates = data
    ? [
        meetsTarget(
          data.latencyMs.speechToTranscript.p50,
          data.targets.speechToTranscript.p50,
        ),
        meetsTarget(
          data.latencyMs.speechToTranscript.p95,
          data.targets.speechToTranscript.p95,
        ),
        meetsTarget(
          data.latencyMs.transcriptToBrainToken.p50,
          data.targets.transcriptToBrainToken.p50,
        ),
        meetsTarget(
          data.latencyMs.speechToFirstAudio.p50,
          data.targets.speechToFirstAudio.p50,
        ),
        meetsTarget(
          data.latencyMs.speechToFirstAudio.p95,
          data.targets.speechToFirstAudio.p95,
        ),
      ]
    : [];
  const measuredGates = gates.filter((gate): gate is boolean => gate != null);
  const healthy = measuredGates.length > 0 && measuredGates.every(Boolean);

  return (
    <Card className="mt-6 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Realtime call latency</h2>
          <p className="mt-1 text-xs text-ink-3">
            Non-tool call turns across the last seven days, measured against internal alpha gates.
          </p>
        </div>
        <AdminHealthBadge
          tone={!data || measuredGates.length === 0 ? "disabled" : healthy ? "healthy" : "degraded"}
          label={!data || measuredGates.length === 0 ? "No data" : healthy ? "On target" : "Review"}
        />
      </div>
      <AdminAsync loading={loading} error={error}>
        {data ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AdminMetricCard
              label="STT p50 / p95"
              value={`${formatLatency(data.latencyMs.speechToTranscript.p50)} / ${formatLatency(data.latencyMs.speechToTranscript.p95)}`}
              hint="targets <700 / <1,500 ms"
            />
            <AdminMetricCard
              label="Brain first token p50"
              value={formatLatency(data.latencyMs.transcriptToBrainToken.p50)}
              hint="target <1,500 ms"
            />
            <AdminMetricCard
              label="Stop → audio p50 / p95"
              value={`${formatLatency(data.latencyMs.speechToFirstAudio.p50)} / ${formatLatency(data.latencyMs.speechToFirstAudio.p95)}`}
              hint="targets <2,500 / <5,000 ms"
            />
            <AdminMetricCard
              label="Turns / failures"
              value={`${data.turns} / ${data.failedTurns}`}
              hint={`${data.workspaces} workspaces · ${data.interruptedTurns} interrupted · ${data.totalWh.toFixed(2)} WH`}
            />
          </div>
        ) : null}
      </AdminAsync>
    </Card>
  );
}
