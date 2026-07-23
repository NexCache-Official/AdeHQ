"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageContainer, PageHeader } from "@/components/Page";
import { PlaybookProgressCard } from "@/components/playbooks/PlaybookProgressCard";
import { Loader2, Activity } from "lucide-react";

type RunPayload = {
  run: {
    id: string;
    status: string;
    actual_wh: number;
    estimated_wh_min: number | null;
    estimated_wh_max: number | null;
    playbook_id: string;
  };
  steps: Array<{
    step_key: string;
    status: string;
    estimated_wh: number | null;
    actual_wh: number;
  }>;
};

export default function PlaybookRunPage() {
  const params = useParams<{ runId: string }>();
  const { state } = useStore();
  const workspaceId = state.workspace?.id;
  const [data, setData] = useState<RunPayload | null>(null);
  const [name, setName] = useState("Playbook run");
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const headers = await authHeaders(workspaceId);
    const res = await fetch(`/api/playbook-runs/${params.runId}`, { headers });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? "Failed to load run");
    setData(body);
  }, [workspaceId, params.runId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!workspaceId || !data?.run.playbook_id) return;
    void (async () => {
      try {
        const headers = await authHeaders(workspaceId);
        const res = await fetch(
          `/api/playbooks/${encodeURIComponent(data.run.playbook_id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { headers },
        );
        const body = await res.json();
        if (res.ok) setName(body.playbook?.name ?? body.definition?.name ?? "Playbook run");
      } catch {
        /* ignore */
      }
    })();
  }, [workspaceId, data?.run.playbook_id]);

  const onStop = async () => {
    if (!workspaceId) return;
    setStopping(true);
    try {
      const headers = await authHeaders(workspaceId);
      const res = await fetch(`/api/playbook-runs/${params.runId}/cancel`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Unable to stop");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stop");
    } finally {
      setStopping(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={name}
        subtitle={`Run ${params.runId}`}
        icon={<Activity className="h-5 w-5" />}
      />

      {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}
      {!data && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
        </div>
      )}

      {data && (
        <PlaybookProgressCard
          playbookName={name}
          status={data.run.status}
          actualWh={data.run.actual_wh}
          estimatedWhMin={data.run.estimated_wh_min}
          estimatedWhMax={data.run.estimated_wh_max}
          steps={data.steps.map((s) => ({
            stepKey: s.step_key,
            status: s.status,
            estimatedWh: s.estimated_wh,
            actualWh: s.actual_wh,
          }))}
          onStop={onStop}
          stopping={stopping}
        />
      )}
    </PageContainer>
  );
}
