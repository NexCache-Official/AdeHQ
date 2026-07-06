"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminPageHeader,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { SupportSearchResult, SupportDetail } from "@/lib/admin/queries/support";
import { LifeBuoy } from "lucide-react";

export default function AdminSupportPage() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const { data, loading, error } = useAdminData<SupportSearchResult>(
    searchTerm ? `/api/admin/support?q=${encodeURIComponent(searchTerm)}&reason=Support+search` : null,
  );

  const loadDetail = async (userId: string) => {
    setSelectedUserId(userId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const { authHeaders } = await import("@/lib/api/auth-client");
      const headers = await authHeaders();
      const res = await fetch(
        `/api/admin/support?userId=${encodeURIComponent(userId)}&reason=Support+detail+view`,
        { headers },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Load failed.");
      setDetail(body.detail);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Load failed.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const userColumns: AdminColumn<SupportSearchResult["users"][number]>[] = [
    { key: "name", header: "Name", render: (r) => r.name },
    { key: "email", header: "Email", render: (r) => r.email },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <Button variant="outline" size="sm" onClick={() => void loadDetail(r.id)}>
          View
        </Button>
      ),
    },
  ];

  const wsColumns: AdminColumn<SupportSearchResult["workspaces"][number]>[] = [
    { key: "name", header: "Workspace", render: (r) => r.name },
    { key: "plan", header: "Plan", render: (r) => r.plan },
    { key: "owner", header: "Owner", render: (r) => r.ownerEmail ?? "—" },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Support"
        subtitle="Privacy-safe diagnostics — metadata only, all access audited."
        icon={<LifeBuoy className="h-5 w-5" />}
      />

      <Card className="mb-6 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearchTerm(query.trim());
            setDetail(null);
            setSelectedUserId(null);
          }}
        >
          <input
            className="input-field flex-1 text-sm"
            placeholder="Search by email, name, or workspace…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!query.trim()}>
            Search
          </Button>
        </form>
        <p className="mt-2 text-xs text-ink-3">
          No raw conversations or files. Searches and detail views are audit-logged.
        </p>
      </Card>

      {searchTerm && (
        <AdminAsync loading={loading} error={error}>
          {data && (
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Users</h2>
                <AdminDataTable
                  columns={userColumns}
                  rows={data.users}
                  rowKey={(r) => r.id}
                  emptyLabel="No users found."
                />
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Workspaces</h2>
                <AdminDataTable
                  columns={wsColumns}
                  rows={data.workspaces}
                  rowKey={(r) => r.id}
                  emptyLabel="No workspaces found."
                />
              </Card>
            </div>
          )}
        </AdminAsync>
      )}

      {selectedUserId && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">User detail</h2>
          {detailLoading && <p className="text-sm text-ink-3">Loading…</p>}
          {detailError && <p className="text-sm text-danger">{detailError}</p>}
          {detail?.user && (
            <div className="space-y-4">
              <div className="text-sm">
                <p className="font-medium text-ink">{detail.user.name}</p>
                <p className="text-ink-3">{detail.user.email}</p>
                <p className="text-xs text-ink-3">
                  Joined {new Date(detail.user.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-ink-3">Workspaces</h3>
                {detail.workspaces.length === 0 ? (
                  <p className="text-sm text-ink-3">No workspaces.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.workspaces.map((w) => (
                      <div
                        key={w.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-medium text-ink">{w.name}</p>
                          <p className="text-xs text-ink-3">
                            {w.plan} · {w.status}
                          </p>
                        </div>
                        <div className="text-right text-xs text-ink-3">
                          <p>{formatUsd(w.costUsd30d)} (30d)</p>
                          <p>{w.failedRuns30d} failed runs</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
