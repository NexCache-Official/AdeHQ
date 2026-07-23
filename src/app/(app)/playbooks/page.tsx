"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageContainer, PageHeader } from "@/components/Page";
import { Button, Card } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { BookOpen, Loader2, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  loadDemoPlaybookCatalog,
  type PlaybookListItem,
} from "@/lib/playbooks/demo-catalog";

type FilterTab = "recommended" | "all" | string;

export default function PlaybooksPage() {
  const { state, backend } = useStore();
  const workspaceId = state.workspace?.id;
  const [items, setItems] = useState<PlaybookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("recommended");

  useEffect(() => {
    if (!workspaceId && backend !== "demo") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (backend === "demo") {
          if (!cancelled) setItems(loadDemoPlaybookCatalog());
          return;
        }
        if (!workspaceId) throw new Error("Not signed in.");
        const headers = await authHeaders(workspaceId);
        const res = await fetch(`/api/playbooks?workspaceId=${encodeURIComponent(workspaceId)}`, {
          headers,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Failed to load playbooks");
        if (!cancelled) setItems(body.playbooks ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, backend]);

  const categories = useMemo(() => {
    const set = new Set(items.map((p) => p.category));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    if (tab === "recommended") {
      return items
        .filter((p) =>
          ["research", "product", "sales", "marketing", "general"].includes(p.category),
        )
        .slice(0, 12);
    }
    return items.filter((p) => p.category === tab);
  }, [items, tab]);

  return (
    <PageContainer>
      <PageHeader
        title="Playbooks"
        subtitle="Reusable multi-step workflows for your AI workforce."
        icon={<BookOpen className="h-5 w-5" />}
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {[
          { id: "recommended", label: "Recommended" },
          { id: "all", label: "All" },
          ...categories.map((c) => ({ id: c, label: c.replace(/_/g, " ") })),
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors",
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading playbooks…
        </div>
      )}
      {error && <p className="text-sm text-rose-500">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="No playbooks yet"
          description="Published platform playbooks will appear here when available."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((pb) => (
          <Card key={pb.id} className="flex flex-col p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                {pb.category.replace(/_/g, " ")}
              </p>
              <h2 className="mt-1 truncate text-sm font-semibold text-ink">{pb.name}</h2>
              <p className="mt-1 line-clamp-2 text-xs text-ink-2">
                {pb.description ?? "No description"}
              </p>
              <p className="mt-2 font-mono text-[11px] text-ink-3">
                {pb.stepCount} steps · {pb.roleCount} roles · est{" "}
                {pb.estimatedWhMin ?? "—"}–{pb.estimatedWhMax ?? "—"} WH
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <Link href={`/playbooks/${encodeURIComponent(pb.id)}`} className="flex-1">
                <Button size="sm" className="w-full">
                  <Play className="h-3.5 w-3.5" /> Run
                </Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
