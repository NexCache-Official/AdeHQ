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
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { FlaskConical } from "lucide-react";

type Experiment = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  variants: unknown[];
  created_at: string;
};

export default function AdminExperimentsPage() {
  const admin = usePlatformAdmin();
  const { data, loading, error, refresh } = useAdminData<{ experiments: Experiment[] }>(
    "/api/admin/experiments",
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";

  const createExperiment = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: name.trim(), status: "draft", variants: [] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Create failed.");
      setName("");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  const columns: AdminColumn<Experiment>[] = [
    { key: "name", header: "Name", render: (r) => r.name },
    {
      key: "status",
      header: "Status",
      render: (r) => <AdminHealthBadge tone={r.status === "running" ? "healthy" : "unknown"} label={r.status} />,
    },
    { key: "variants", header: "Variants", align: "right", render: (r) => r.variants?.length ?? 0 },
    { key: "created", header: "Created", render: (r) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Experiments"
        subtitle="A/B rollouts and feature experiments."
        icon={<FlaskConical className="h-5 w-5" />}
      />

      {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}

      {canWrite && (
        <Card className="mb-6 p-4">
          <div className="flex gap-2">
            <input
              className="input-field flex-1 text-sm"
              placeholder="Experiment name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void createExperiment()}>
              Create draft
            </Button>
          </div>
        </Card>
      )}

      <AdminAsync loading={loading} error={error}>
        {data && (
          <AdminDataTable
            columns={columns}
            rows={data.experiments}
            rowKey={(r) => r.id}
            emptyLabel="No experiments yet."
          />
        )}
      </AdminAsync>
    </div>
  );
}
