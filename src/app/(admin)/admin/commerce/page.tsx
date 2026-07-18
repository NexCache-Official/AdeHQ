"use client";

import { useState } from "react";
import { Card, Button } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminPageHeader,
  formatDate,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { authHeaders } from "@/lib/api/auth-client";
import { Layers, RefreshCw } from "lucide-react";

type CommerceResponse = {
  roles: string[];
  revolut: {
    configured: boolean;
    environment: string;
    webhookVerified: boolean;
    currency: string;
  };
  versions: {
    id: string;
    version: number;
    public_name: string;
    weekly_included_wh: number;
    status: string;
    visibility: string;
  }[];
  prices: {
    id: string;
    currency: string;
    cadence: string;
    amount_minor: number;
    sync_status: string;
    status: string;
    revolut_variation_id: string | null;
  }[];
  promotions: {
    id: string;
    code: string | null;
    name: string;
    status: string;
    enforcement: string;
  }[];
  topups: {
    id: string;
    code: string;
    version: number;
    wh_amount: number;
    price_minor: number;
    status: string;
  }[];
  subscriptions: {
    id: string;
    workspace_id: string;
    plan_slug: string;
    provider_status: string | null;
    service_access_status: string;
    current_period_end: string | null;
    legacy_manual_renew: boolean;
  }[];
  audits: {
    id: string;
    action: string;
    entity_type: string;
    reason: string | null;
    created_at: string;
  }[];
  notes: { noEditLive: boolean; refundPolicy: string };
};

export default function AdminCommercePage() {
  const { data, error, loading, refresh } = useAdminData<CommerceResponse>("/api/admin/commerce");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/commerce", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ action, ...payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Action failed");
      setMessage(JSON.stringify(json));
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const versionCols: AdminColumn<CommerceResponse["versions"][number]>[] = [
    { key: "name", header: "Name", render: (r) => r.public_name },
    { key: "version", header: "Ver", render: (r) => `v${r.version}` },
    { key: "wh", header: "WH/week", render: (r) => String(r.weekly_included_wh) },
    { key: "status", header: "Status", render: (r) => r.status },
    { key: "visibility", header: "Visibility", render: (r) => r.visibility },
  ];

  const priceCols: AdminColumn<CommerceResponse["prices"][number]>[] = [
    { key: "cadence", header: "Cadence", render: (r) => r.cadence },
    {
      key: "amount",
      header: "Amount",
      render: (r) => `$${(r.amount_minor / 100).toFixed(2)} ${r.currency}`,
    },
    { key: "sync", header: "Sync", render: (r) => r.sync_status },
    {
      key: "variation",
      header: "Revolut variation",
      render: (r) => r.revolut_variation_id ?? "—",
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy === `sync:${r.id}`}
          onClick={() =>
            runAction("sync_price", { priceId: r.id, reason: "Admin sync from Commerce" })
          }
        >
          Sync
        </Button>
      ),
    },
  ];

  const subCols: AdminColumn<CommerceResponse["subscriptions"][number]>[] = [
    { key: "workspace", header: "Workspace", render: (r) => r.workspace_id.slice(0, 8) },
    { key: "plan", header: "Plan", render: (r) => r.plan_slug },
    { key: "provider", header: "Provider", render: (r) => r.provider_status ?? "—" },
    { key: "access", header: "Access", render: (r) => r.service_access_status },
    {
      key: "end",
      header: "Period end",
      render: (r) => (r.current_period_end ? formatDate(r.current_period_end) : "—"),
    },
    {
      key: "legacy",
      header: "Legacy",
      render: (r) => (r.legacy_manual_renew ? "yes" : "no"),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Commerce"
        subtitle="Ops: provider sync, subscription inspector, and audit. Edit live prices in Plans."
        icon={<Layers className="h-5 w-5" />}
        actions={
          <Button variant="secondary" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <AdminAsync loading={loading} error={error}>
        {data ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="p-4">
                <p className="text-sm text-muted">Your commerce roles</p>
                <p className="mt-1 font-medium">{data.roles.join(", ")}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted">Revolut</p>
                <p className="mt-1 font-medium">
                  {data.revolut.configured ? data.revolut.environment : "not configured"} ·{" "}
                  {data.revolut.currency}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted">Policy</p>
                <p className="mt-1 text-sm">{data.notes.refundPolicy}</p>
              </Card>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy === "reconcile_subscriptions"}
                onClick={() => runAction("reconcile_subscriptions", { reason: "Manual reconcile" })}
              >
                <Layers className="h-4 w-4" />
                Reconcile subscriptions
              </Button>
            </div>
            {message ? (
              <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
                {message}
              </pre>
            ) : null}

            <Card className="p-4">
              <h2 className="mb-3 text-lg font-semibold">Plan versions</h2>
              <AdminDataTable
                columns={versionCols}
                rows={data.versions}
                rowKey={(r) => r.id}
              />
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-lg font-semibold">Prices (provider sync)</h2>
              <AdminDataTable columns={priceCols} rows={data.prices} rowKey={(r) => r.id} />
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-lg font-semibold">Top-up products</h2>
              <AdminDataTable
                columns={[
                  {
                    key: "code",
                    header: "Code",
                    render: (r) => `${r.code} v${r.version}`,
                  },
                  { key: "wh", header: "WH", render: (r) => String(r.wh_amount) },
                  {
                    key: "price",
                    header: "Price",
                    render: (r) => `$${(r.price_minor / 100).toFixed(2)}`,
                  },
                  { key: "status", header: "Status", render: (r) => r.status },
                ]}
                rows={data.topups}
                rowKey={(r) => r.id}
              />
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-lg font-semibold">Subscription inspector</h2>
              <AdminDataTable columns={subCols} rows={data.subscriptions} rowKey={(r) => r.id} />
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-lg font-semibold">Promotions</h2>
              <AdminDataTable
                columns={[
                  { key: "name", header: "Name", render: (r) => r.name },
                  { key: "code", header: "Code", render: (r) => r.code ?? "—" },
                  { key: "enforcement", header: "Enforcement", render: (r) => r.enforcement },
                  { key: "status", header: "Status", render: (r) => r.status },
                ]}
                rows={data.promotions}
                rowKey={(r) => r.id}
              />
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-lg font-semibold">Audit</h2>
              <AdminDataTable
                columns={[
                  { key: "when", header: "When", render: (r) => formatDate(r.created_at) },
                  { key: "action", header: "Action", render: (r) => r.action },
                  { key: "entity", header: "Entity", render: (r) => r.entity_type },
                  { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
                ]}
                rows={data.audits}
                rowKey={(r) => r.id}
              />
            </Card>
          </>
        ) : null}
      </AdminAsync>
    </div>
  );
}
