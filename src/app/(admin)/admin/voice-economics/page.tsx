"use client";

import { useState } from "react";
import { AudioLines } from "lucide-react";
import {
  AdminAsync,
  AdminDataTable,
  AdminMetricCard,
  AdminPageHeader,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type {
  VoiceEconomicsBreakdown,
  VoiceEconomicsSummary,
} from "@/lib/admin/queries/voice-economics";
import type { AdminRange } from "@/lib/admin/queries/helpers";

const RANGES: AdminRange[] = ["1d", "7d", "30d", "90d"];

const columns: AdminColumn<VoiceEconomicsBreakdown>[] = [
  { key: "label", header: "Segment", render: (row) => row.label },
  {
    key: "cogs",
    header: "Internal COGS",
    align: "right",
    render: (row) => formatUsd(row.internalCogsUsd),
  },
  {
    key: "absorbed",
    header: "Absorbed",
    align: "right",
    render: (row) => formatUsd(row.platformAbsorbedUsd),
  },
  {
    key: "charged",
    header: "Customer $",
    align: "right",
    render: (row) => formatUsd(row.customerChargedUsd),
  },
  {
    key: "wh",
    header: "Customer WH",
    align: "right",
    render: (row) => row.customerWorkHours.toFixed(3),
  },
  {
    key: "minutes",
    header: "Call minutes",
    align: "right",
    render: (row) => row.liveCallMinutes.toFixed(2),
  },
  { key: "events", header: "Events", align: "right", render: (row) => row.events },
];

export default function AdminVoiceEconomicsPage() {
  const [range, setRange] = useState<AdminRange>("30d");
  const { data, loading, error } = useAdminData<VoiceEconomicsSummary>(
    `/api/admin/voice-economics?range=${range}`,
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Voice economics"
        subtitle="Superadmin view of internal voice COGS, platform subsidy, customer charges, Work Hours, and monthly call-minute consumption."
        icon={<AudioLines className="h-5 w-5" />}
      />
      <div className="flex flex-wrap gap-2">
        {RANGES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setRange(item)}
            className={
              range === item
                ? "rounded-full bg-ink px-3 py-1 text-xs font-medium text-white"
                : "rounded-full bg-muted px-3 py-1 text-xs font-medium text-ink-2"
            }
          >
            {item.toUpperCase()}
          </button>
        ))}
      </div>
      <AdminAsync loading={loading} error={error}>
        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <AdminMetricCard
                label="Internal voice COGS"
                value={formatUsd(data.metrics.internalCogsUsd)}
              />
              <AdminMetricCard
                label="Platform absorbed"
                value={formatUsd(data.metrics.platformAbsorbedUsd)}
              />
              <AdminMetricCard
                label="Customer charged"
                value={formatUsd(data.metrics.customerChargedUsd)}
              />
              <AdminMetricCard
                label="Customer Work Hours"
                value={data.metrics.customerWorkHours.toFixed(3)}
              />
              <AdminMetricCard
                label="Live-call minutes"
                value={data.metrics.liveCallMinutes.toFixed(2)}
                hint="Per call session; participant and AI counts do not multiply minutes."
              />
              <AdminMetricCard label="Calls" value={String(data.metrics.calls)} />
            </div>
            <Breakdown title="By capability" rows={data.byCapability} />
            <Breakdown title="By plan" rows={data.byPlan} />
            <Breakdown title="By workspace" rows={data.byWorkspace} />
          </>
        ) : null}
      </AdminAsync>
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: VoiceEconomicsBreakdown[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <AdminDataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        emptyLabel="No voice usage in this range."
      />
    </section>
  );
}
