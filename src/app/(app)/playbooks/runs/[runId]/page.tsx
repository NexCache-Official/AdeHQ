"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageContainer, PageHeader } from "@/components/Page";
import { PlaybookProgressCard } from "@/components/playbooks/PlaybookProgressCard";
import {
  advanceDemoPlaybookRun,
  cancelDemoPlaybookRun,
  getDemoPlaybookRun,
  type DemoPlaybookRun,
} from "@/lib/playbooks/demo-catalog";
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
    name?: string;
  }>;
};

function fromDemo(run: DemoPlaybookRun): RunPayload {
  return {
    run: {
      id: run.id,
      status: run.status,
      actual_wh: run.actualWh,
      estimated_wh_min: run.estimatedWhMin,
      estimated_wh_max: run.estimatedWhMax,
      playbook_id: run.playbookId,
    },
    steps: run.steps.map((s) => ({
      step_key: s.step_key,
      status: s.status,
      estimated_wh: s.estimated_wh,
      actual_wh: s.actual_wh,
      name: s.name,
    })),
  };
}

export default function PlaybookRunPage() {
  const params = useParams<{ runId: string }>();
  const { state, backend } = useStore();
  const workspaceId = state.workspace?.id;
  const [data, setData] = useState<RunPayload | null>(null);
  const [name, setName] = useState("Playbook run");
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(async () => {
    if (backend === "demo" || params.runId.startsWith("demo_run_")) {
      const demo = getDemoPlaybookRun(params.runId);
      if (!demo) throw new Error("Demo run not found.");
      const advanced =
        demo.status === "running" ? advanceDemoPlaybookRun(params.runId) ?? demo : demo;
      setData(fromDemo(advanced));
      setName(advanced.playbookName);
      return;
    }
    if (!workspaceId) return;
    const headers = await authHeaders(workspaceId);
    const res = await fetch(`/api/playbook-runs/${params.runId}`, { headers });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? "Failed to load run");
    setData(body);
  }, [workspaceId, params.runId, backend]);

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
    }, backend === "demo" ? 1200 : 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, backend]);

  useEffect(() => {
    if (backend === "demo") return;
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
  }, [workspaceId, data?.run.playbook_id, backend]);

  const onStop = async () => {
    setStopping(true);
    try {
      if (backend === "demo" || params.runId.startsWith("demo_run_")) {
        const cancelled = cancelDemoPlaybookRun(params.runId);
        if (cancelled) setData(fromDemo(cancelled));
        return;
      }
      if (!workspaceId) return;
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
        subtitle="Live progress for this playbook run."
        icon={<Activity className="h-5 w-5" />}
      />

      {!data && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading run…
        </div>
      )}
      {error && <p className="text-sm text-rose-500">{error}</p>}

      {data && (
        <PlaybookProgressCard
          playbookName={name}
          status={data.run.status}
          estimatedWhMin={data.run.estimated_wh_min}
          estimatedWhMax={data.run.estimated_wh_max}
          actualWh={data.run.actual_wh}
          steps={data.steps.map((s) => ({
            stepKey: s.step_key,
            label: s.name ?? s.step_key,
            status: s.status,
            actualWh: s.actual_wh,
            estimatedWh: s.estimated_wh,
          }))}
          onStop={
            data.run.status === "running" || data.run.status === "queued"
              ? onStop
              : undefined
          }
          stopping={stopping}
        />
      )}
    </PageContainer>
  );
}
