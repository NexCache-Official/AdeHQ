"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button } from "@/components/ui";
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
          value={w.plan}
          disabled={busyId === w.id}
          onChange={(e) => void setPlan(w, e.target.value)}
        >
          {["founder", "starter", "growth", "business", "enterprise"].map((p) => (
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
            render: (w: AdminWorkspaceRow) =>
              w.status === "disabled" ? (
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
    </div>
  );
}
