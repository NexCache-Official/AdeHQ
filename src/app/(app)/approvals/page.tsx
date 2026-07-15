"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { ApprovalCard } from "@/components/ApprovalCard";
import { EmptyState } from "@/components/States";
import { cn } from "@/lib/utils";
import { ClipboardCheck, ShieldCheck } from "lucide-react";

const FILTERS = ["pending", "approved", "rejected", "all"] as const;

export default function ApprovalsPage() {
  const { state, actions } = useStore();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("id");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
  const focusRef = useRef<HTMLDivElement | null>(null);

  // Live refresh: mount, focus, visibility, and a short poll so Review navigation
  // does not require a manual reload.
  useEffect(() => {
    void actions.refreshWorkspace();
    const onVisible = () => {
      if (document.visibilityState === "visible") void actions.refreshWorkspace();
    };
    const onFocus = () => void actions.refreshWorkspace();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    const poll = window.setInterval(() => {
      void actions.refreshWorkspace();
    }, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
    };
  }, [actions]);

  useEffect(() => {
    if (!focusId) return;
    void actions.ensureApproval(focusId);
    setFilter("all");
  }, [actions, focusId]);

  useEffect(() => {
    if (!focusId || !focusRef.current) return;
    focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, state.approvals]);

  const approvals = useMemo(() => {
    const list = state.approvals.filter((a) => filter === "all" || a.status === filter);
    if (!focusId) return list;
    return [...list].sort((a, b) => {
      if (a.id === focusId) return -1;
      if (b.id === focusId) return 1;
      return 0;
    });
  }, [filter, focusId, state.approvals]);

  const pendingCount = state.approvals.filter((a) => a.status === "pending").length;

  return (
    <PageContainer>
      <PageHeader
        title="Approvals"
        subtitle="Approvals make your AI employees trustworthy. Review what they want to do before they act."
        icon={<ClipboardCheck className="h-5 w-5" />}
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count =
            f === "all"
              ? state.approvals.length
              : state.approvals.filter((a) => a.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-accent-500/15 text-accent-700 ring-1 ring-inset ring-accent-500/30"
                  : "bg-slate-50 text-slate-400 hover:bg-slate-100",
              )}
            >
              {f} <span className="text-slate-500">{count}</span>
            </button>
          );
        })}
      </div>

      {approvals.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={filter === "pending" ? "You're all caught up" : "Nothing here"}
          description={
            filter === "pending"
              ? `No pending approvals${pendingCount === 0 ? "" : ""}. Your employees will ask when they need permission.`
              : "No approvals match this filter."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {approvals.map((a) => (
            <div
              key={a.id}
              ref={a.id === focusId ? focusRef : undefined}
              className={cn(
                a.id === focusId && "rounded-xl ring-2 ring-accent-500/40 ring-offset-2",
              )}
            >
              <ApprovalCard approval={a} />
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
