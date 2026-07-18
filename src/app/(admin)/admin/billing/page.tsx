"use client";

import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminMetricCard,
  AdminPageHeader,
  formatDate,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { CreditCard, RefreshCw, Receipt, TrendingUp } from "lucide-react";

type PaymentsMode = "sandbox" | "production" | "not_configured";

type BillingResponse = {
  paymentProvider: string;
  paymentsConnected: boolean;
  paymentsMode: PaymentsMode;
  webhookVerified: boolean;
  currency?: string;
  readiness?: {
    merchantApiKey: boolean;
    webhookSecret: boolean;
    environment: string;
    currency: string;
    keyKind?: string;
    baseUrl?: string;
    apiVersion?: string;
    webhookPath: string;
  };
  metrics: {
    mrrCents: number;
    arrCents: number;
    mrrLabel: string;
    arrLabel: string;
    revenue30dCents: number;
    revenue30dLabel: string;
    revenueAllTimeCents: number;
    revenueAllTimeLabel: string;
    activePaidWorkspaces: number;
    cancelledWorkspaces: number;
    cancelAtPeriodEnd: number;
    paidInvoiceCount: number;
  };
  statusBreakdown: Record<string, number>;
  upcomingRenewals: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    planSlug: string;
    planDisplayName: string;
    status: string;
    renewsAt: string | null;
    cancelAtPeriodEnd: boolean;
  }[];
  subscriptions: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    status: string;
    planSlug: string;
    planDisplayName: string;
    interval: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
  }[];
  recentInvoices: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    status: string;
    amountCents: number;
    currency: string;
    createdAt: string;
    hasExternalPayment: boolean;
  }[];
  recentGrants: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    amount: number;
    creditType: string;
    reason: string | null;
    createdAt: string;
  }[];
};

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export default function AdminBillingPage() {
  const { data, loading, error } = useAdminData<BillingResponse>("/api/admin/billing");

  const subColumns: AdminColumn<BillingResponse["subscriptions"][number]>[] = [
    {
      key: "workspace",
      header: "Workspace",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{r.workspaceName}</div>
          <div className="truncate text-[11px] text-ink-3">{r.workspaceId.slice(0, 8)}…</div>
        </div>
      ),
    },
    { key: "plan", header: "Plan", render: (r) => r.planDisplayName },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="capitalize">
          {r.status}
          {r.cancelAtPeriodEnd ? " · ending" : ""}
        </span>
      ),
    },
    { key: "interval", header: "Cycle", render: (r) => r.interval },
    {
      key: "period",
      header: "Term ends",
      render: (r) => formatDate(r.currentPeriodEnd),
    },
  ];

  const invoiceColumns: AdminColumn<BillingResponse["recentInvoices"][number]>[] = [
    {
      key: "workspace",
      header: "Workspace",
      render: (r) => r.workspaceName,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => formatMoney(r.amountCents, r.currency),
    },
    { key: "status", header: "Status", render: (r) => <span className="capitalize">{r.status}</span> },
    { key: "when", header: "Paid", render: (r) => formatDate(r.createdAt) },
    {
      key: "ext",
      header: "Revolut",
      render: (r) => (r.hasExternalPayment ? "Linked" : "—"),
    },
  ];

  const renewalColumns: AdminColumn<BillingResponse["upcomingRenewals"][number]>[] = [
    { key: "workspace", header: "Workspace", render: (r) => r.workspaceName },
    { key: "plan", header: "Plan", render: (r) => r.planDisplayName },
    { key: "when", header: "Renews", render: (r) => formatDate(r.renewsAt) },
    {
      key: "note",
      header: "Note",
      render: (r) => (r.cancelAtPeriodEnd ? "Cancels at period end" : "Active"),
    },
  ];

  const grantColumns: AdminColumn<BillingResponse["recentGrants"][number]>[] = [
    { key: "workspace", header: "Workspace", render: (r) => r.workspaceName },
    { key: "type", header: "Type", render: (r) => r.creditType },
    { key: "amount", header: "WH", align: "right", render: (r) => r.amount },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
    { key: "created", header: "Created", render: (r) => formatDate(r.createdAt) },
  ];

  const revolutLabel =
    data?.paymentsMode === "production"
      ? "Live"
      : data?.paymentsMode === "sandbox"
        ? "Sandbox"
        : "Not connected";
  const revolutTone: "healthy" | "degraded" | "unknown" =
    data?.paymentsMode === "production"
      ? "healthy"
      : data?.paymentsMode === "sandbox"
        ? "degraded"
        : "unknown";

  return (
    <div>
      <AdminPageHeader
        title="Billing"
        subtitle="Membership revenue, renewals, and Revolut payments — workspace names only, no member emails."
        icon={<CreditCard className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <AdminMetricCard
                label="Revolut"
                value={<AdminHealthBadge tone={revolutTone} label={revolutLabel} />}
                hint={data.webhookVerified ? "Webhook secret set" : "Webhook secret missing"}
              />
              <AdminMetricCard
                label="MRR"
                value={data.metrics.mrrLabel}
                hint={`ARR ${data.metrics.arrLabel}`}
                tone="positive"
              />
              <AdminMetricCard
                label="Revenue (30d)"
                value={data.metrics.revenue30dLabel}
                hint={`${data.metrics.paidInvoiceCount} paid invoices tracked`}
              />
              <AdminMetricCard
                label="Paid workspaces"
                value={data.metrics.activePaidWorkspaces}
                hint={
                  data.metrics.cancelAtPeriodEnd
                    ? `${data.metrics.cancelAtPeriodEnd} ending at period close`
                    : `${data.metrics.cancelledWorkspaces} cancelled / expired`
                }
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-1">
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-accent" />
                  <h2 className="text-sm font-semibold text-ink">Membership mix</h2>
                </div>
                <ul className="space-y-2 text-sm">
                  {Object.keys(data.statusBreakdown).length === 0 ? (
                    <li className="text-ink-3">No subscriptions yet.</li>
                  ) : (
                    Object.entries(data.statusBreakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <li key={status} className="flex items-center justify-between">
                          <span className="capitalize text-ink-2">{status.replaceAll("_", " ")}</span>
                          <span className="tabular-nums font-medium text-ink">{count}</span>
                        </li>
                      ))
                  )}
                </ul>
                <p className="mt-4 text-xs text-ink-3">
                  All-time collected: {data.metrics.revenueAllTimeLabel}
                </p>
              </Card>

              <Card className="p-5 lg:col-span-2">
                <div className="mb-3 flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-accent" />
                  <h2 className="text-sm font-semibold text-ink">Renewals (next 30 days)</h2>
                </div>
                <AdminDataTable
                  columns={renewalColumns}
                  rows={data.upcomingRenewals}
                  rowKey={(r) => r.id}
                  emptyLabel="No renewals in the next 30 days."
                />
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-accent" />
                  <h2 className="text-sm font-semibold text-ink">Subscriptions</h2>
                </div>
                <AdminDataTable
                  columns={subColumns}
                  rows={data.subscriptions}
                  rowKey={(r) => r.id}
                  emptyLabel="No subscriptions yet."
                />
              </Card>
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-accent" />
                  <h2 className="text-sm font-semibold text-ink">Recent payments</h2>
                </div>
                <AdminDataTable
                  columns={invoiceColumns}
                  rows={data.recentInvoices}
                  rowKey={(r) => r.id}
                  emptyLabel="No invoices yet — complete a Pro checkout to see the first payment."
                />
              </Card>
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Work Hour credit grants</h2>
              <AdminDataTable
                columns={grantColumns}
                rows={data.recentGrants}
                rowKey={(r) => r.id}
                emptyLabel="No credit grants yet."
              />
            </Card>

            {data.readiness && (
              <Card className="p-5">
                <h2 className="mb-2 text-sm font-semibold text-ink">Revolut readiness</h2>
                <p className="mb-3 text-sm text-ink-3">
                  Hosted checkout activates a local plan term. Renewals are re-checkout / admin / promo —
                  not Revolut Subscriptions auto-charge.
                </p>
                <ul className="grid gap-1.5 text-sm text-ink-2 sm:grid-cols-2">
                  <li>
                    Merchant API key:{" "}
                    <span className="font-medium">{data.readiness.merchantApiKey ? "set" : "missing"}</span>
                    {data.readiness.keyKind ? (
                      <span className="text-ink-3"> · kind {data.readiness.keyKind}</span>
                    ) : null}
                  </li>
                  <li>
                    Webhook secret:{" "}
                    <span className="font-medium">{data.readiness.webhookSecret ? "set" : "missing"}</span>
                  </li>
                  <li>
                    Environment: <span className="font-medium">{data.readiness.environment}</span>
                  </li>
                  <li>
                    Currency: <span className="font-medium">{data.readiness.currency}</span>
                  </li>
                  {data.readiness.baseUrl ? (
                    <li className="sm:col-span-2">
                      API host:{" "}
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                        {data.readiness.baseUrl}
                      </code>
                      {data.readiness.apiVersion ? (
                        <span className="text-ink-3"> · v{data.readiness.apiVersion}</span>
                      ) : null}
                    </li>
                  ) : null}
                  <li className="sm:col-span-2">
                    Webhook:{" "}
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                      {data.readiness.webhookPath}
                    </code>
                  </li>
                </ul>
              </Card>
            )}
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
