"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageContainer, PageHeader } from "@/components/Page";
import { PlaybookRunWizard } from "@/components/playbooks/PlaybookRunWizard";
import type { PlaybookDefinitionV1 } from "@/lib/playbooks/contracts";
import {
  createDemoPlaybookRun,
  loadDemoPlaybookDetail,
} from "@/lib/playbooks/demo-catalog";
import { BookOpen, Loader2 } from "lucide-react";

export default function PlaybookDetailPage() {
  const params = useParams<{ playbookId: string }>();
  const playbookId = decodeURIComponent(params.playbookId);
  const router = useRouter();
  const { state, backend } = useStore();
  const workspaceId = state.workspace?.id;

  const [definition, setDefinition] = useState<PlaybookDefinitionV1 | null>(null);
  const [estimate, setEstimate] = useState<{
    estimatedWhMin: number;
    estimatedWhMax: number;
    hardWhLimit: number;
  } | null>(null);
  const [name, setName] = useState("Playbook");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!workspaceId && backend !== "demo") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (backend === "demo") {
          const detail = loadDemoPlaybookDetail(playbookId);
          if (!detail) throw new Error("Playbook not found.");
          if (cancelled) return;
          setDefinition(detail.definition);
          setEstimate(detail.estimate);
          setName(detail.name);
          return;
        }
        if (!workspaceId) throw new Error("Not signed in.");
        const headers = await authHeaders(workspaceId);
        const res = await fetch(
          `/api/playbooks/${encodeURIComponent(playbookId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { headers },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Failed to load");
        if (cancelled) return;
        setDefinition(body.definition);
        setEstimate(body.estimate);
        setName(body.playbook?.name ?? body.definition?.name ?? "Playbook");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, playbookId, backend]);

  const onRun = async (payload: {
    inputPayload: Record<string, unknown>;
    selectedEmployeeIds: string[];
  }) => {
    setRunning(true);
    setError(null);
    try {
      if (backend === "demo") {
        if (!definition || !estimate) throw new Error("Playbook not loaded.");
        void payload;
        const run = createDemoPlaybookRun({
          playbookId,
          definition,
          estimate,
        });
        router.push(`/playbooks/runs/${run.id}`);
        return;
      }
      if (!workspaceId) throw new Error("Not signed in.");
      const headers = await authHeaders(workspaceId);
      const res = await fetch(`/api/playbooks/${encodeURIComponent(playbookId)}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId,
          ...payload,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Unable to start run");
      router.push(`/playbooks/runs/${body.run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start run");
      setRunning(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={name}
        subtitle="Configure inputs, team, and start a playbook run."
        icon={<BookOpen className="h-5 w-5" />}
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

      {definition && (
        <PlaybookRunWizard
          definition={definition}
          estimate={estimate}
          employees={state.employees.map((e) => ({
            id: e.id,
            name: e.name,
            role: e.roleKey,
          }))}
          onRun={onRun}
          running={running}
        />
      )}
    </PageContainer>
  );
}
