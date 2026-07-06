"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Modal, ModalHeader } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  formatBytes,
  formatDate,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { AdminWorkspaceRow } from "@/lib/admin/queries/workspaces";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { Database } from "lucide-react";

export default function AdminWorkspacesPage() {
  const admin = usePlatformAdmin();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [managing, setManaging] = useState<AdminWorkspaceRow | null>(null);
  const { data, loading, error, refresh } = useAdminData<{ workspaces: AdminWorkspaceRow[] }>(
    `/api/admin/workspaces${query ? `?search=${encodeURIComponent(query)}` : ""}`,
  );

  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";

  const setStatus = async (workspace: AdminWorkspaceRow, status: string) => {
    const verb = status === "disabled" ? "Disable" : "Re-enable";
    if (!window.confirm(`${verb} workspace "${workspace.name}"? This is audited.`)) return;
    setBusyId(workspace.id);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Update failed.");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  };

  const setPlan = async (workspace: AdminWorkspaceRow, plan: string) => {
    if (!window.confirm(`Change "${workspace.name}" plan to ${plan}? This is audited.`)) return;
    setBusyId(workspace.id);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ plan, reason: "Plan changed from AdeHQ Control" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Update failed.");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  };

  const columns: AdminColumn<AdminWorkspaceRow>[] = [
    {
      key: "name",
      header: "Workspace",
      render: (w) => (
        <div>
          <p className="font-medium text-ink">{w.name}</p>
          <p className="text-xs text-ink-3">{w.ownerEmail ?? "unknown owner"}</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", render: (w) => (
      canWrite ? (
        <select
          className="input-field text-xs"
          value={["free", "pro", "team", "business", "enterprise"].includes(w.plan) ? w.plan : "free"}
          disabled={busyId === w.id}
          onChange={(e) => void setPlan(w, e.target.value)}
        >
          {["free", "pro", "team", "business", "enterprise"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      ) : w.plan
    )},
    {
      key: "status",
      header: "Status",
      render: (w) => (
        <AdminHealthBadge
          tone={w.status === "disabled" ? "disabled" : w.status === "test" ? "unknown" : "healthy"}
          label={w.status}
        />
      ),
    },
    { key: "members", header: "Members", align: "right", render: (w) => w.memberCount },
    { key: "employees", header: "AI staff", align: "right", render: (w) => w.employeeCount },
    { key: "rooms", header: "Rooms", align: "right", render: (w) => w.roomCount },
    { key: "cost", header: "Cost (7d)", align: "right", render: (w) => formatUsd(w.costUsd7d) },
    { key: "browser", header: "Browser (7d)", align: "right", render: (w) => w.browserRuns7d },
    { key: "storage", header: "Storage", align: "right", render: (w) => formatBytes(w.storageUsedBytes) },
    { key: "created", header: "Created", render: (w) => formatDate(w.createdAt) },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (w: AdminWorkspaceRow) => (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setManaging(w)}>
                  Manage
                </Button>
                {w.status === "disabled" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === w.id}
                    onClick={() => void setStatus(w, "active")}
                  >
                    Enable
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === w.id}
                    onClick={() => void setStatus(w, "disabled")}
                  >
                    Disable
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <AdminPageHeader
        title="Workspaces"
        subtitle="All customer workspaces with usage and status."
        icon={<Database className="h-5 w-5" />}
      />

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <input
          type="search"
          className="input-field max-w-sm text-sm"
          placeholder="Search by workspace name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}

      <AdminAsync loading={loading} error={error}>
        <AdminDataTable
          columns={columns}
          rows={data?.workspaces ?? []}
          rowKey={(w) => w.id}
          emptyLabel="No workspaces found."
        />
      </AdminAsync>

      {managing && (
        <WorkspaceOverridesModal
          workspace={managing}
          onClose={() => setManaging(null)}
          onDone={() => {
            setManaging(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function WorkspaceOverridesModal({
  workspace,
  onClose,
  onDone,
}: {
  workspace: AdminWorkspaceRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [workHours, setWorkHours] = useState(100);
  const [overridePlan, setOverridePlan] = useState("business");
  const [subStatus, setSubStatus] = useState("comped");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const run = async (action: string, payload: Record<string, unknown>) => {
    if (!reason.trim()) {
      setError("A reason is required (this action is audited).");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/workspaces/${workspace.id}/overrides`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, reason, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Action failed.");
      setOk("Done. This change is recorded in the audit log.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title={`Manage ${workspace.name}`} subtitle="Overrides and credits — all audited." onClose={onClose} />
      <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Reason (required)</span>
          <input className="input-field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Founder deal, support comp" />
        </label>

        <div className="rounded-xl border border-border-2 p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Grant AI Work Hours</h3>
          <div className="flex items-end gap-2">
            <input type="number" className="input-field w-40" value={workHours} onChange={(e) => setWorkHours(Number(e.target.value))} />
            <Button size="sm" disabled={busy} onClick={() => run("grant_work_hours", { amount: workHours })}>Grant</Button>
          </div>
        </div>

        <div className="rounded-xl border border-border-2 p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Set plan override</h3>
          <div className="flex items-end gap-2">
            <select className="input-field w-40" value={overridePlan} onChange={(e) => setOverridePlan(e.target.value)}>
              {["free", "pro", "team", "business", "enterprise"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <Button size="sm" disabled={busy} onClick={() => run("set_plan_override", { planSlug: overridePlan })}>Set</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run("clear_plan_override", {})}>Clear</Button>
          </div>
        </div>

        <div className="rounded-xl border border-border-2 p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Subscription status</h3>
          <div className="flex items-end gap-2">
            <select className="input-field w-40" value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>
              {["trialing", "active", "past_due", "cancelled", "expired", "manual", "comped", "enterprise"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Button size="sm" disabled={busy} onClick={() => run("set_subscription_status", { status: subStatus })}>Apply</Button>
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {ok && <p className="text-sm text-emerald-600">{ok}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border-2 px-6 py-4">
        <Button variant="outline" onClick={onDone}>Close & refresh</Button>
      </div>
    </Modal>
  );
}
