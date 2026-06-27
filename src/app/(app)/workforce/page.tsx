"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "@/components/AppShell";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmployeeCard } from "@/components/EmployeeCard";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { EmployeeStatusBadge } from "@/components/EmployeeStatusBadge";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { cn } from "@/lib/utils";
import { EmployeeStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/icons";
import { Bot, LayoutGrid, List, Search, UserPlus } from "lucide-react";

const STATUS_FILTERS: (EmployeeStatus | "all")[] = ["all", "working", "idle", "waiting_approval", "on_call", "blocked"];

export default function WorkforcePage() {
  const { state } = useStore();
  const ui = useShellUI();
  const router = useRouter();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EmployeeStatus | "all">("all");
  const [provider, setProvider] = useState<string>("all");

  const providers = useMemo(
    () => ["all", ...Array.from(new Set(state.employees.map((e) => e.provider)))],
    [state.employees],
  );

  const filtered = state.employees.filter((e) => {
    if (status !== "all" && e.status !== status) return false;
    if (provider !== "all" && e.provider !== provider) return false;
    if (query && !`${e.name} ${e.role}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <PageContainer wide>
      <PageHeader
        title="AI Workforce"
        subtitle="Hire, manage, and monitor the AI employees working across your projects."
        icon={<Bot className="h-5 w-5" />}
        actions={
          <Button onClick={ui.openHire}>
            <UserPlus className="h-4 w-4" /> Hire AI Employee
          </Button>
        }
      />

      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employees…"
            className="input-field !pl-9"
          />
        </div>
        <select className="input-field sm:w-44" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p} value={p}>{p === "all" ? "All providers" : p}</option>
          ))}
        </select>
        <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          <button onClick={() => setView("grid")} className={cn("flex h-9 w-9 items-center justify-center rounded-lg transition-colors", view === "grid" ? "bg-slate-100 text-slate-900" : "text-slate-500")}>
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button onClick={() => setView("list")} className={cn("flex h-9 w-9 items-center justify-center rounded-lg transition-colors", view === "list" ? "bg-slate-100 text-slate-900" : "text-slate-500")}>
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Status pills */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => {
          const count = s === "all" ? state.employees.length : state.employees.filter((e) => e.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                status === s ? "bg-accent-500/15 text-accent-700 ring-1 ring-inset ring-accent-500/30" : "bg-slate-50 text-slate-400 hover:bg-slate-100",
              )}
            >
              {s !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[s].dot)} />}
              {s === "all" ? "All" : STATUS_META[s].label}
              <span className="text-slate-500">{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No employees match"
          description="Try adjusting your filters, or hire a new AI employee."
          action={{ label: "Hire AI Employee", onClick: ui.openHire }}
        />
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <EmployeeCard key={e.id} employee={e} onMessage={(emp) => router.push(emp.defaultRoomId ? `/rooms/${emp.defaultRoomId}` : "/rooms")} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          {filtered.map((e, i) => {
            const room = state.rooms.find((r) => r.id === e.defaultRoomId);
            return (
              <button
                key={e.id}
                onClick={() => router.push(`/workforce/${e.id}`)}
                className={cn(
                  "flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                  i !== 0 && "border-t border-slate-200",
                )}
              >
                <EmployeeAvatar employee={e} size="md" />
                <div className="min-w-0 flex-[2]">
                  <div className="truncate text-sm font-semibold text-slate-900">{e.name}</div>
                  <div className="truncate text-xs text-slate-500">{e.role}</div>
                </div>
                <div className="hidden flex-1 text-xs text-slate-500 sm:block">{e.provider} · {e.model}</div>
                <div className="hidden flex-1 truncate text-xs text-slate-500 md:block">{room?.name ?? "—"}</div>
                <div className="hidden flex-1 text-xs text-slate-500 lg:block">{e.tools.length} tools · {e.tasksCompleted} done</div>
                <EmployeeStatusBadge status={e.status} />
              </button>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
