"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Card, Modal, ModalHeader } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  formatDate,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { Ticket } from "lucide-react";

type PromoRow = {
  id: string;
  code: string;
  description: string | null;
  active: boolean;
  discount_type: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  extra_work_hours_per_week: number | null;
  applies_to_plan: string | null;
  duration_type: string;
  expires_at: string | null;
  redemptionCount: number;
};

const DISCOUNT_TYPES = [
  "percent_off",
  "amount_off",
  "free_trial_days",
  "free_months",
  "extra_work_hours",
  "plan_override",
];

export default function AdminPromoCodesPage() {
  const admin = usePlatformAdmin();
  const canWrite = admin.role === "super_admin" || admin.role === "billing_admin";
  const { data, loading, error, refresh } = useAdminData<{ promoCodes: PromoRow[] }>("/api/admin/promo-codes");
  const [creating, setCreating] = useState(false);

  const toggleActive = async (promo: PromoRow) => {
    const headers = await authHeaders();
    await fetch(`/api/admin/promo-codes/${promo.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ updates: { active: !promo.active } }),
    });
    await refresh();
  };

  const columns: AdminColumn<PromoRow>[] = [
    { key: "code", header: "Code", render: (p) => <span className="font-mono font-medium text-ink">{p.code}</span> },
    { key: "type", header: "Type", render: (p) => <span className="text-xs">{p.discount_type}</span> },
    {
      key: "value",
      header: "Value",
      render: (p) =>
        p.percent_off
          ? `${p.percent_off}%`
          : p.amount_off_cents
            ? `$${(p.amount_off_cents / 100).toFixed(0)}`
            : p.extra_work_hours_per_week
              ? `+${p.extra_work_hours_per_week} hrs/wk`
              : "—",
    },
    { key: "plan", header: "Plan", render: (p) => p.applies_to_plan ?? "any" },
    { key: "duration", header: "Duration", render: (p) => p.duration_type },
    { key: "redemptions", header: "Redeemed", align: "right", render: (p) => p.redemptionCount },
    { key: "expires", header: "Expires", render: (p) => formatDate(p.expires_at) },
    { key: "active", header: "Status", render: (p) => <AdminHealthBadge tone={p.active ? "healthy" : "disabled"} label={p.active ? "Active" : "Inactive"} /> },
    ...(canWrite
      ? [
          {
            key: "toggle",
            header: "",
            align: "right" as const,
            render: (p: PromoRow) => (
              <Button size="sm" variant="ghost" onClick={() => void toggleActive(p)}>
                {p.active ? "Deactivate" : "Activate"}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <AdminPageHeader
        title="Promo Codes"
        subtitle="Discounts, extra Work Hours, and plan overrides for launches and deals."
        icon={<Ticket className="h-5 w-5" />}
        actions={canWrite ? <Button size="sm" onClick={() => setCreating(true)}>New promo code</Button> : undefined}
      />

      <AdminAsync loading={loading} error={error}>
        <AdminDataTable columns={columns} rows={data?.promoCodes ?? []} rowKey={(p) => p.id} emptyLabel="No promo codes yet." />
      </AdminAsync>

      {creating && (
        <CreatePromoModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function CreatePromoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState("percent_off");
  const [value, setValue] = useState(50);
  const [appliesToPlan, setAppliesToPlan] = useState("");
  const [durationType, setDurationType] = useState("once");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        code,
        discountType,
        durationType,
        appliesToPlan: appliesToPlan || undefined,
      };
      if (discountType === "percent_off") payload.percentOff = value;
      else if (discountType === "amount_off") payload.amountOffCents = Math.round(value * 100);
      else if (discountType === "extra_work_hours") payload.extraWorkHoursPerWeek = value;
      else if (discountType === "free_trial_days") payload.freeTrialDays = value;
      else if (discountType === "free_months") payload.freeMonths = value;

      const headers = await authHeaders();
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Create failed.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title="New promo code" onClose={onClose} icon={<Ticket className="h-5 w-5" />} />
      <div className="space-y-4 px-6 py-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Code</span>
          <input className="input-field uppercase" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LAUNCH50" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-3">Type</span>
            <select className="input-field" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
              {DISCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-3">Value</span>
            <input type="number" className="input-field" value={value} onChange={(e) => setValue(Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-3">Applies to plan (optional)</span>
            <input className="input-field" value={appliesToPlan} onChange={(e) => setAppliesToPlan(e.target.value)} placeholder="pro" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-3">Duration</span>
            <select className="input-field" value={durationType} onChange={(e) => setDurationType(e.target.value)}>
              {["once", "repeating_months", "forever"].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border-2 px-6 py-4">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={create} disabled={busy || !code}>{busy ? "Creating…" : "Create"}</Button>
      </div>
    </Modal>
  );
}
