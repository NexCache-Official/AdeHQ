"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { useWorkspaceUsage } from "@/hooks/useWorkspaceUsage";
import { canManageWorkspaceSettings, canViewBilling } from "@/lib/workspace/permissions";
import { PageHeader } from "@/components/Page";
import { Card, Button, Progress } from "@/components/ui";
import { Bot, Timer } from "lucide-react";

const AUTONOMY_STEP_BUDGETS = [4, 6, 8, 12, 16, 20];

type AutonomyDefaults = {
  autonomyStepBudget: number;
  autonomyCostBudgetUsd: number;
};

function formatResetDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function SettingsWorkHoursPage() {
  const { state, backend } = useStore();
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role ?? "member";
  const { data, loading, error } = useWorkspaceUsage(state.workspace.id);
  const canManageAiDefaults =
    backend === "supabase" && canManageWorkspaceSettings(myRole) && Boolean(state.workspace.id);
  const [autonomyDefaults, setAutonomyDefaults] = useState<AutonomyDefaults>({
    autonomyStepBudget: 8,
    autonomyCostBudgetUsd: 0.5,
  });
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [defaultsMessage, setDefaultsMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canManageAiDefaults) return;
    let active = true;
    setDefaultsLoading(true);
    setDefaultsMessage(null);
    void (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/workspaces/${state.workspace.id}/ai-settings`, { headers });
        const body = (await res.json()) as Partial<AutonomyDefaults> & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Unable to load autopilot defaults.");
        if (!active) return;
        setAutonomyDefaults({
          autonomyStepBudget: Number(body.autonomyStepBudget ?? 8),
          autonomyCostBudgetUsd: Number(body.autonomyCostBudgetUsd ?? 0.5),
        });
      } catch (err) {
        if (active) setDefaultsMessage(err instanceof Error ? err.message : "Unable to load autopilot defaults.");
      } finally {
        if (active) setDefaultsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [canManageAiDefaults, state.workspace.id]);

  const saveAutonomyDefaults = async () => {
    if (!canManageAiDefaults) return;
    setDefaultsSaving(true);
    setDefaultsMessage(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${state.workspace.id}/ai-settings`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(autonomyDefaults),
      });
      const body = (await res.json()) as Partial<AutonomyDefaults> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Unable to save autopilot defaults.");
      setAutonomyDefaults({
        autonomyStepBudget: Number(body.autonomyStepBudget ?? autonomyDefaults.autonomyStepBudget),
        autonomyCostBudgetUsd: Number(body.autonomyCostBudgetUsd ?? autonomyDefaults.autonomyCostBudgetUsd),
      });
      setDefaultsMessage("Saved autopilot defaults.");
    } catch (err) {
      setDefaultsMessage(err instanceof Error ? err.message : "Unable to save autopilot defaults.");
    } finally {
      setDefaultsSaving(false);
    }
  };

  const cap = data?.capacity;
  const allowance = cap?.allowance ?? 0;
  const used = data?.totalWorkHours ?? cap?.used ?? 0;
  const remaining =
    cap?.unlimited || allowance <= 0
      ? (cap?.remaining ?? 0)
      : Math.max(0, Math.round((allowance - used) * 100) / 100);
  const unlimited = cap?.unlimited ?? false;
  const pct = unlimited || !allowance ? 0 : Math.min(100, (used / allowance) * 100);

  return (
    <>
      <PageHeader
        title="AI Work Hours"
        subtitle="Pooled workspace AI capacity on a rolling 7-day usage clock. Human messaging is always unlimited."
        icon={<Timer className="h-5 w-5" />}
      />

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <Card className="p-6">
        {loading ? (
          <p className="text-sm text-ink-3">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  This period
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                  {unlimited ? "Unlimited" : `${remaining.toFixed(2)} left`}
                </p>
                {!unlimited && (
                  <p className="mt-0.5 text-sm text-ink-3">
                    {used.toFixed(2)} of {allowance.toFixed(2)} AI Work Hours used
                  </p>
                )}
              </div>
              <div className="text-right text-sm text-ink-3">
                <p className="capitalize">{cap?.planSlug ?? "free"} plan</p>
                <p>Resets {cap ? formatResetDate(cap.resetsAt) : "soon"}</p>
              </div>
            </div>

            {!unlimited && (
              <div className="mt-4">
                <Progress value={pct} />
              </div>
            )}

            {cap?.warningLevel === "exhausted" && !unlimited && (
              <div className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                Your AI employees are paused because this workspace has used its AI Work Hours for this period.
                Human messaging still works. They resume when the period resets{canViewBilling(myRole) ? ", or you can upgrade for more capacity." : ". Ask a workspace admin to upgrade for more capacity."}
              </div>
            )}
            {cap?.warningLevel === "low" && !unlimited && (
              <div className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                Your workspace is running low on AI Work Hours for this period.
              </div>
            )}

            {canViewBilling(myRole) && (
              <div className="mt-5">
                <Link href="/settings/billing">
                  <Button size="sm">View plans & upgrade</Button>
                </Link>
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="mt-4 p-6 text-sm text-ink-2">
        <h2 className="mb-2 text-sm font-semibold text-ink">What are AI Work Hours?</h2>
        <p>
          AI Work Hours are a simple way to measure AI workload across chat, search, browsing, files,
          and reports. Simple messages use very little. Advanced work like browser research,
          long-context analysis, coding, or large reports uses more.
        </p>
      </Card>

      {canManageAiDefaults && (
        <Card className="mt-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-ink">Autopilot defaults</h2>
              </div>
              <p className="mt-1 text-sm text-ink-3">
                Used when an employee starts autonomous work from chat or a launcher uses the workspace default.
              </p>
            </div>
            <Button size="sm" onClick={() => void saveAutonomyDefaults()} disabled={defaultsLoading || defaultsSaving}>
              {defaultsSaving ? "Saving..." : "Save defaults"}
            </Button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Default step budget</span>
              <select
                className="input-field"
                value={autonomyDefaults.autonomyStepBudget}
                disabled={defaultsLoading}
                onChange={(e) =>
                  setAutonomyDefaults((current) => ({
                    ...current,
                    autonomyStepBudget: Number(e.target.value),
                  }))
                }
              >
                {AUTONOMY_STEP_BUDGETS.map((budget) => (
                  <option key={budget} value={budget}>
                    {budget} steps
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Default cost budget</span>
              <input
                className="input-field"
                type="number"
                min={0.01}
                max={25}
                step={0.05}
                value={autonomyDefaults.autonomyCostBudgetUsd}
                disabled={defaultsLoading}
                onChange={(e) =>
                  setAutonomyDefaults((current) => ({
                    ...current,
                    autonomyCostBudgetUsd: Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>
          {defaultsMessage && <p className="mt-3 text-xs font-medium text-ink-3">{defaultsMessage}</p>}
        </Card>
      )}
    </>
  );
}
