"use client";

import { useMemo, useState } from "react";
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
import type {
  ProviderAllocationSummaryRow,
  ProviderCredentialSummaryRow,
  ProviderCredentialsSummary,
} from "@/lib/admin/queries/provider-credentials";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { KeyRound, ShieldAlert } from "lucide-react";

const PROVIDERS = ["siliconflow", "vercel_gateway", "tavily", "browserbase"];

function statusTone(status: string): "healthy" | "degraded" | "disabled" | "unknown" {
  if (status === "active") return "healthy";
  if (status === "untested" || status === "rotating") return "degraded";
  if (status === "disabled" || status === "revoked") return "disabled";
  return "unknown";
}

export default function AdminProviderCredentialsPage() {
  const admin = usePlatformAdmin();
  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";
  const { data, loading, error, refresh } =
    useAdminData<ProviderCredentialsSummary>("/api/admin/provider-credentials");
  const [form, setForm] = useState({ provider: "siliconflow", label: "", apiKey: "", reason: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const credentials = data?.credentials ?? [];
  const allocations = data?.allocations ?? [];

  const envWarnings = useMemo(
    () => (data?.envFallbackProviders ?? []).filter((provider) => !credentials.some((c) => c.provider === provider && c.status === "active")),
    [data?.envFallbackProviders, credentials],
  );

  const request = async (url: string, init: RequestInit = {}) => {
    const headers = await authHeaders();
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status}).`);
    return body;
  };

  const createCredential = async () => {
    setBusy("create");
    setMessage(null);
    try {
      await request("/api/admin/provider-credentials", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm((current) => ({ ...current, label: "", apiKey: "" }));
      setMessage("Credential created as untested.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(null);
    }
  };

  const mutateCredential = async (id: string, action: string) => {
    const reason = window.prompt(`Reason for ${action}?`) ?? "";
    setBusy(`${id}:${action}`);
    setMessage(null);
    try {
      await request(`/api/admin/provider-credentials/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, reason }),
      });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  };

  const testCredential = async (id: string) => {
    setBusy(`${id}:test`);
    setMessage(null);
    try {
      const result = await request(`/api/admin/provider-credentials/${id}/test`, { method: "POST" });
      setMessage(result.detail ?? "Smoke test passed.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Smoke test failed.");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const credentialColumns: AdminColumn<ProviderCredentialSummaryRow>[] = [
    {
      key: "credential",
      header: "Credential",
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.label}</p>
          <p className="font-mono text-[11px] text-ink-3">{row.provider} · ...{row.keyLast4}</p>
          {row.duplicateFingerprint && <p className="mt-1 text-xs text-danger">Duplicate fingerprint</p>}
        </div>
      ),
    },
    { key: "scope", header: "Scope", render: (row) => row.scope },
    {
      key: "status",
      header: "Status",
      render: (row) => <AdminHealthBadge tone={statusTone(row.status)} label={row.status} />,
    },
    {
      key: "usage",
      header: "Budget",
      render: (row) => (
        <div className="text-xs text-ink-3">
          <p>Today ${row.budget?.costTodayUsd.toFixed(4) ?? "0.0000"}</p>
          <p>{row.budget?.requestsToday ?? 0} requests</p>
        </div>
      ),
    },
    {
      key: "health",
      header: "Health",
      render: (row) => (
        <div className="text-xs text-ink-3">
          <p>{Math.round((row.health?.errorRate ?? 0) * 100)}% errors</p>
          <p>{row.allocatedWorkspaceCount} workspaces</p>
        </div>
      ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (row: ProviderCredentialSummaryRow) => (
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="outline" disabled={busy === `${row.id}:test`} onClick={() => void testCredential(row.id)}>
                  Test
                </Button>
                <Button size="sm" variant="outline" disabled={busy === `${row.id}:disable`} onClick={() => void mutateCredential(row.id, "disable")}>
                  Disable
                </Button>
                <Button size="sm" variant="danger" disabled={busy === `${row.id}:revoke`} onClick={() => void mutateCredential(row.id, "revoke")}>
                  Revoke
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const allocationColumns: AdminColumn<ProviderAllocationSummaryRow>[] = [
    { key: "workspace", header: "Workspace", render: (row) => row.workspaceName ?? row.workspaceId },
    { key: "provider", header: "Provider", render: (row) => row.provider },
    { key: "type", header: "Type", render: (row) => row.allocationType },
    { key: "status", header: "Status", render: (row) => <AdminHealthBadge tone={statusTone(row.status)} label={row.status} /> },
    { key: "credential", header: "Credential", render: (row) => row.credentialId?.slice(0, 8) ?? "pool/env" },
  ];

  return (
    <>
      <AdminPageHeader
        title="Provider Credentials"
        subtitle="Encrypted provider key registry, workspace allocations, budget gates, and rotation controls."
        icon={<KeyRound className="h-5 w-5" />}
      />

      {envWarnings.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4" />
            <p>
              Env fallback is active for {envWarnings.join(", ")}. Import these keys into AdeHQ Control
              for rotation, budgets, and credential-level ledger attribution.
            </p>
          </div>
        </Card>
      )}

      {canWrite && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Add credential</h2>
          <div className="grid gap-3 md:grid-cols-[180px_1fr_1.5fr_1fr_auto]">
            <select className="input-field" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
            <input className="input-field" placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <input className="input-field" placeholder="Secret key" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            <input className="input-field" placeholder="Audit reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <Button disabled={busy === "create" || !form.label || !form.apiKey} onClick={() => void createCredential()}>
              Add
            </Button>
          </div>
        </Card>
      )}

      {message && <p className="mb-4 rounded-xl bg-muted px-3 py-2 text-sm text-ink-2">{message}</p>}

      <AdminAsync loading={loading} error={error}>
        <div className="space-y-4">
          <AdminDataTable columns={credentialColumns} rows={credentials} rowKey={(row) => row.id} emptyLabel="No managed credentials yet." />
          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Workspace allocations</h2>
            <AdminDataTable columns={allocationColumns} rows={allocations} rowKey={(row) => row.id} emptyLabel="No allocations yet." />
          </div>
        </div>
      </AdminAsync>
    </>
  );
}
