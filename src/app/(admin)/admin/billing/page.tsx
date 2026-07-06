"use client";

import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminMetricCard,
  AdminPageHeader,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { CreditCard } from "lucide-react";

type BillingResponse = {
  stripeConnected: boolean;
  mrrCents: number | null;
  activePaidWorkspaces: number;
  billingCustomers: number;
  subscriptions: {
    id: string;
    workspace_id: string;
    status: string;
    plan_slug: string;
    current_period_end: string | null;
  }[];
  recentInvoices: {
    id: string;
    workspace_id: string;
    status: string;
    amount_due_cents: number;
    created_at: string;
  }[];
  recentGrants: {
    id: string;
    workspace_id: string;
    amount: number;
    credit_type: string;
    reason: string | null;
    created_at: string;
  }[];
};

export default function AdminBillingPage() {
  const { data, loading, error } = useAdminData<BillingResponse>("/api/admin/billing");

  const subColumns: AdminColumn<BillingResponse["subscriptions"][number]>[] = [
    { key: "plan", header: "Plan", render: (r) => r.plan_slug },
    { key: "status", header: "Status", render: (r) => r.status },
    {
      key: "period",
      header: "Period end",
      render: (r) => (r.current_period_end ? new Date(r.current_period_end).toLocaleDateString() : "—"),
    },
  ];

  const grantColumns: AdminColumn<BillingResponse["recentGrants"][number]>[] = [
    { key: "type", header: "Type", render: (r) => r.credit_type },
    { key: "amount", header: "Amount", align: "right", render: (r) => r.amount },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
    { key: "created", header: "Created", render: (r) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Billing"
        subtitle="Revenue, subscriptions, credits, and Stripe events."
        icon={<CreditCard className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <AdminMetricCard
                label="Stripe"
                value={
                  <AdminHealthBadge
                    tone={data.stripeConnected ? "healthy" : "unknown"}
                    label={data.stripeConnected ? "Connected" : "Not connected"}
                  />
                }
              />
              <AdminMetricCard label="MRR" value={data.mrrCents != null ? formatUsd(data.mrrCents / 100) : "—"} />
              <AdminMetricCard label="Active subs" value={data.activePaidWorkspaces} />
              <AdminMetricCard label="Customers" value={data.billingCustomers} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Subscriptions</h2>
                <AdminDataTable
                  columns={subColumns}
                  rows={data.subscriptions}
                  rowKey={(r) => r.id}
                  emptyLabel="No subscriptions yet."
                />
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Recent credit grants</h2>
                <AdminDataTable
                  columns={grantColumns}
                  rows={data.recentGrants}
                  rowKey={(r) => r.id}
                  emptyLabel="No credit grants yet."
                />
              </Card>
            </div>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
