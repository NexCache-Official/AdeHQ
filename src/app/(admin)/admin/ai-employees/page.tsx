"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminMetricCard,
  AdminPageHeader,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { Bot } from "lucide-react";

type Template = {
  id: string;
  role_key: string;
  display_name: string;
  is_active: boolean;
  default_intelligence_mode: string | null;
};

export default function AdminAiEmployeesPage() {
  const admin = usePlatformAdmin();
  const { data, loading, error, refresh } = useAdminData<{
    dbTemplates: Template[];
    codeRoleCount: number;
    versions: { id: string; template_id: string; version: number }[];
  }>("/api/admin/ai-employees");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";

  const seedTemplates = async () => {
    if (!window.confirm("Seed prompt templates from role library? Existing roles are skipped.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/ai-employees", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "seed" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Seed failed.");
      setMsg(`Seeded ${body.inserted} templates (${body.skipped} skipped).`);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Seed failed.");
    } finally {
      setBusy(false);
    }
  };

  const columns: AdminColumn<Template>[] = [
    { key: "name", header: "Role", render: (r) => r.display_name },
    { key: "key", header: "Key", render: (r) => <span className="font-mono text-xs">{r.role_key}</span> },
    { key: "mode", header: "Intelligence", render: (r) => r.default_intelligence_mode ?? "—" },
    { key: "active", header: "Active", render: (r) => (r.is_active ? "Yes" : "No") },
  ];

  return (
    <div>
      <AdminPageHeader
        title="AI Employees"
        subtitle="Role templates and prompt versions."
        icon={<Bot className="h-5 w-5" />}
        actions={
          canWrite ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void seedTemplates()}>
              {busy ? "Seeding…" : "Seed from role library"}
            </Button>
          ) : undefined
        }
      />

      {msg && <p className="mb-3 text-sm text-ink-2">{msg}</p>}

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <AdminMetricCard label="DB templates" value={data.dbTemplates.length} />
              <AdminMetricCard label="Code roles" value={data.codeRoleCount} />
              <AdminMetricCard label="Versions" value={data.versions.length} />
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Prompt templates</h2>
              <AdminDataTable
                columns={columns}
                rows={data.dbTemplates}
                rowKey={(r) => r.id}
                emptyLabel="No templates in DB — seed from role library."
              />
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
