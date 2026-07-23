"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageContainer, PageHeader } from "@/components/Page";
import { Card } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { FileStack, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedArtifact } from "@/lib/types";

type FilterTab =
  | "all"
  | "document"
  | "presentation"
  | "workbook"
  | "report"
  | "in_review";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "document", label: "Documents" },
  { id: "presentation", label: "Presentations" },
  { id: "workbook", label: "Spreadsheets" },
  { id: "report", label: "Reports" },
  { id: "in_review", label: "In review" },
];

export default function ArtifactsLibraryPage() {
  const { state } = useStore();
  const workspaceId = state.workspace?.id;
  const [items, setItems] = useState<SavedArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const headers = await authHeaders(workspaceId);
        const res = await fetch(
          `/api/artifacts?workspaceId=${encodeURIComponent(workspaceId)}`,
          { headers },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Failed to load artifacts");
        if (!cancelled) setItems(body.artifacts ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    if (tab === "in_review") {
      return items.filter((a) => String(a.status) === "in_review");
    }
    return items.filter((a) => {
      const kind = String((a.metadata as { kind?: string } | undefined)?.kind ?? "");
      const type = String(a.artifactType);
      if (kind && kind === tab) return true;
      if (tab === "document") {
        return ["prd", "brief", "note", "proposal", "document"].includes(type);
      }
      if (tab === "presentation") return type === "presentation";
      if (tab === "workbook") return type === "workbook" || type === "dataset";
      if (tab === "report") {
        return ["report", "research_summary", "strategy_memo"].includes(type);
      }
      return true;
    });
  }, [items, tab]);

  return (
    <PageContainer>
      <PageHeader
        title="Artifacts"
        subtitle="Structured deliverables from playbooks and your team."
        icon={<FileStack className="h-5 w-5" />}
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
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

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading artifacts…
        </div>
      )}
      {error && <p className="text-sm text-rose-500">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={FileStack}
          title="No artifacts"
          description="Artifacts created by playbooks or saved from chat will show up here."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => (
          <Link key={a.id} href={`/artifacts/${a.id}`}>
            <Card className="h-full p-4 transition-colors hover:border-accent/40">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                {a.artifactType.replace(/_/g, " ")}
              </p>
              <h2 className="mt-1 truncate text-sm font-semibold text-ink">{a.title}</h2>
              <p className="mt-2 text-[11px] capitalize text-ink-3">
                {a.status.replace(/_/g, " ")}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
