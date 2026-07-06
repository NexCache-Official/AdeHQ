"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminPageHeader,
  formatDate,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { AdminUserRow } from "@/lib/admin/queries/users";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { Users } from "lucide-react";

export default function AdminUsersPage() {
  const admin = usePlatformAdmin();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, loading, error, refresh } = useAdminData<{ users: AdminUserRow[] }>(
    `/api/admin/users${query ? `?search=${encodeURIComponent(query)}` : ""}`,
  );

  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";

  const disableUser = async (user: AdminUserRow, disabled: boolean) => {
    const verb = disabled ? "Disable" : "Re-enable";
    if (!window.confirm(`${verb} ${user.email}? This is audited.`)) return;
    setBusyId(user.id);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ disabled }),
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

  const columns: AdminColumn<AdminUserRow>[] = [
    { key: "email", header: "Email", render: (u) => <span className="font-medium text-ink">{u.email}</span> },
    { key: "name", header: "Name", render: (u) => u.name },
    { key: "created", header: "Created", render: (u) => formatDate(u.createdAt) },
    { key: "lastActive", header: "Last active", render: (u) => formatDate(u.lastActiveAt) },
    { key: "plan", header: "Plan", render: (u) => u.plan ?? "—" },
    { key: "workspaces", header: "Workspaces", align: "right", render: (u) => u.workspaceCount },
    { key: "cost", header: "Cost (30d)", align: "right", render: (u) => formatUsd(u.costUsd30d) },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (u: AdminUserRow) => (
              <Button
                variant="outline"
                size="sm"
                disabled={busyId === u.id}
                onClick={() => void disableUser(u, true)}
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
        title="Users"
        subtitle="Privacy-safe account metadata — no message content."
        icon={<Users className="h-5 w-5" />}
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
          placeholder="Search by email or name…"
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
          rows={data?.users ?? []}
          rowKey={(u) => u.id}
          emptyLabel="No users found."
        />
      </AdminAsync>
    </div>
  );
}
