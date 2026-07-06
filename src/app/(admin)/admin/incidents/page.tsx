"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { IncidentRow } from "@/lib/admin/queries/incidents";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { Siren } from "lucide-react";

export default function AdminIncidentsPage() {
  const admin = usePlatformAdmin();
  const { data, loading, error, refresh } = useAdminData<{ incidents: IncidentRow[] }>(
    "/api/admin/incidents",
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");

  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";

  const createIncident = async () => {
    if (!title.trim()) return;
    if (!window.confirm("Create incident? This is audited.")) return;
    setBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/incidents", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: title.trim(),
          severity,
          incidentType: "other",
          reason: "Incident opened from AdeHQ Control",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Create failed.");
      setTitle("");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (incident: IncidentRow, status: string) => {
    if (!window.confirm(`Set incident to ${status}?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/incidents/${incident.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status, reason: "Status updated from AdeHQ Control" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Update failed.");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const columns: AdminColumn<IncidentRow>[] = [
    { key: "title", header: "Title", render: (r) => r.title },
    { key: "type", header: "Type", render: (r) => r.incidentType },
    {
      key: "severity",
      header: "Severity",
      render: (r) => (
        <AdminHealthBadge
          tone={r.severity === "critical" || r.severity === "high" ? "degraded" : "healthy"}
          label={r.severity}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <AdminHealthBadge tone={r.status === "resolved" ? "healthy" : "degraded"} label={r.status} />,
    },
    { key: "started", header: "Started", render: (r) => new Date(r.startedAt).toLocaleString() },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (r: IncidentRow) =>
              r.status !== "resolved" ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void updateStatus(r, "resolved")}>
                  Resolve
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div>
      <AdminPageHeader
        title="Incidents"
        subtitle="Incident command center — track outages and platform issues."
        icon={<Siren className="h-5 w-5" />}
      />

      {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}

      {canWrite && (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Open incident</h2>
          <div className="flex flex-wrap gap-2">
            <input
              className="input-field min-w-[240px] flex-1 text-sm"
              placeholder="Incident title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="input-field text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <Button size="sm" disabled={busy || !title.trim()} onClick={() => void createIncident()}>
              Create
            </Button>
          </div>
        </Card>
      )}

      <AdminAsync loading={loading} error={error}>
        {data && (
          <AdminDataTable
            columns={columns}
            rows={data.incidents}
            rowKey={(r) => r.id}
            emptyLabel="No incidents recorded."
          />
        )}
      </AdminAsync>
    </div>
  );
}
