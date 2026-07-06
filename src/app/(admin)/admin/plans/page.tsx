"use client";

import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { ListChecks } from "lucide-react";

type PlanRow = {
  plan_slug: string;
  display_name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  trial_days: number;
  is_active: boolean;
  weekly_work_hours: number;
  max_ai_employees: number;
  browser_research_enabled: boolean;
};

export default function AdminPlansPage() {
  const { data, loading, error } = useAdminData<{ plans: PlanRow[] }>("/api/admin/plans");

  const columns: AdminColumn<PlanRow>[] = [
    { key: "slug", header: "Plan", render: (p) => <span className="font-medium text-ink">{p.display_name}</span> },
    { key: "slugId", header: "Slug", render: (p) => <span className="font-mono text-xs">{p.plan_slug}</span> },
    {
      key: "monthly",
      header: "Monthly",
      align: "right",
      render: (p) => `$${(p.monthly_price_cents / 100).toFixed(2)}`,
    },
    {
      key: "annual",
      header: "Annual",
      align: "right",
      render: (p) => `$${(p.annual_price_cents / 100).toFixed(2)}`,
    },
    { key: "hours", header: "Work Hrs/wk", align: "right", render: (p) => p.weekly_work_hours },
    { key: "employees", header: "Max AI", align: "right", render: (p) => p.max_ai_employees },
    {
      key: "browser",
      header: "Browser",
      render: (p) => (
        <AdminHealthBadge
          tone={p.browser_research_enabled ? "healthy" : "disabled"}
          label={p.browser_research_enabled ? "Yes" : "No"}
        />
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (p) => (
        <AdminHealthBadge tone={p.is_active ? "healthy" : "disabled"} label={p.is_active ? "Active" : "Inactive"} />
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Plans"
        subtitle="Internal plan configs — Stripe integration in Stage 3."
        icon={<ListChecks className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        <AdminDataTable
          columns={columns}
          rows={data?.plans ?? []}
          rowKey={(p) => p.plan_slug}
          emptyLabel="No plans configured."
        />
      </AdminAsync>

      <Card className="mt-4 p-4 text-sm text-ink-3">
        Plan editing and workspace assignment ship in Stage 3. These rows seed entitlements for
        future billing.
      </Card>
    </div>
  );
}
