"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageContainer, PageHeader } from "@/components/Page";
import { Button, Card } from "@/components/ui";
import { FileStack, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedArtifact } from "@/lib/types";

type TabId = "preview" | "content" | "sources" | "versions" | "review" | "activity";

const TABS: { id: TabId; label: string }[] = [
  { id: "preview", label: "Preview" },
  { id: "content", label: "Content" },
  { id: "sources", label: "Sources" },
  { id: "versions", label: "Versions" },
  { id: "review", label: "Review" },
  { id: "activity", label: "Activity" },
];

export default function ArtifactDetailPage() {
  const params = useParams<{ artifactId: string }>();
  const { state } = useStore();
  const workspaceId = state.workspace?.id;
  const [artifact, setArtifact] = useState<SavedArtifact | null>(null);
  const [versions, setVersions] = useState<unknown[]>([]);
  const [exports, setExports] = useState<unknown[]>([]);
  const [sources, setSources] = useState<{
    fileIds: string[];
    messageIds: string[];
    citations: unknown[];
    provenance: unknown[];
  } | null>(null);
  const [tab, setTab] = useState<TabId>("preview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const headers = await authHeaders(workspaceId);
    const [detailRes, sourcesRes, exportsRes] = await Promise.all([
      fetch(`/api/artifacts/${params.artifactId}`, { headers }),
      fetch(`/api/artifacts/${params.artifactId}/sources`, { headers }),
      fetch(`/api/artifacts/${params.artifactId}/exports`, { headers }),
    ]);
    const detail = await detailRes.json();
    if (!detailRes.ok) throw new Error(detail?.error ?? "Failed to load artifact");
    setArtifact(detail.artifact);
    setVersions(detail.versions ?? []);

    if (sourcesRes.ok) {
      const s = await sourcesRes.json();
      setSources({
        fileIds: s.sources?.fileIds ?? [],
        messageIds: s.sources?.messageIds ?? [],
        citations: s.sources?.citations ?? [],
        provenance: s.provenance ?? [],
      });
    }
    if (exportsRes.ok) {
      const e = await exportsRes.json();
      setExports(e.exports ?? []);
    }
  }, [workspaceId, params.artifactId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const exportFormat = async (format: string) => {
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders(workspaceId);
      const res = await fetch(`/api/artifacts/${params.artifactId}/export`, {
        method: "POST",
        headers,
        body: JSON.stringify({ format }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Export failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const headers = await authHeaders(workspaceId);
      const res = await fetch(`/api/artifacts/${params.artifactId}/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Approve failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={artifact?.title ?? "Artifact"}
        subtitle={artifact ? `${artifact.artifactType} · ${artifact.status}` : undefined}
        icon={<FileStack className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => exportFormat("docx")}>
              Export DOCX
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => exportFormat("pdf")}>
              Export PDF
            </Button>
            <Button size="sm" disabled={busy} onClick={approve}>
              Approve
            </Button>
          </div>
        }
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-accent text-white"
                : "bg-panel-2 text-ink-2 hover:bg-panel hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {artifact && (
        <Card className="p-5">
          {tab === "preview" && (
            <div className="prose prose-sm max-w-none text-ink-2">
              <pre className="whitespace-pre-wrap font-sans text-sm">
                {(artifact.contentMarkdown || "").slice(0, 4000) || "No preview content."}
              </pre>
            </div>
          )}
          {tab === "content" && (
            <pre className="max-h-[480px] overflow-auto rounded-lg bg-panel-2 p-3 text-xs text-ink-2">
              {JSON.stringify(artifact.contentJson ?? {}, null, 2)}
            </pre>
          )}
          {tab === "sources" && (
            <div className="space-y-2 text-sm text-ink-2">
              <p>Files: {(sources?.fileIds ?? []).length}</p>
              <p>Messages: {(sources?.messageIds ?? []).length}</p>
              <p>Citations: {(sources?.citations ?? []).length}</p>
              <p>Provenance rows: {(sources?.provenance ?? []).length}</p>
            </div>
          )}
          {tab === "versions" && (
            <ul className="space-y-2 text-sm">
              {(versions as Array<Record<string, unknown>>).map((v) => (
                <li key={String(v.id)} className="rounded-lg border border-border px-3 py-2">
                  v{String(v.version_number)} · {String(v.status ?? "—")} ·{" "}
                  <span className="font-mono text-[11px] text-ink-3">
                    {String(v.content_hash ?? "").slice(0, 12) || "no hash"}
                  </span>
                </li>
              ))}
              {!versions.length && <p className="text-ink-3">No versions yet.</p>}
            </ul>
          )}
          {tab === "review" && (
            <div className="space-y-2 text-sm text-ink-2">
              <p>Current status: {artifact.status}</p>
              <p>Use Approve in the header, or submit changes via the review API.</p>
            </div>
          )}
          {tab === "activity" && (
            <ul className="space-y-2 text-sm">
              {(exports as Array<Record<string, unknown>>).map((ex) => (
                <li key={String(ex.id)} className="rounded-lg border border-border px-3 py-2">
                  Export {String(ex.format)} · {String(ex.status)}
                </li>
              ))}
              {!exports.length && <p className="text-ink-3">No export activity yet.</p>}
            </ul>
          )}
        </Card>
      )}
    </PageContainer>
  );
}
