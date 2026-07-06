"use client";

import { useState } from "react";
import { Button, Card, Modal, ModalHeader, Toggle } from "@/components/ui";
import { authHeaders } from "@/lib/api/auth-client";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { ListChecks, Pencil } from "lucide-react";

type PlanRow = {
  plan_slug: string;
  display_name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  trial_days: number;
  is_active: boolean;
  weekly_work_hours: number;
  human_members_unlimited: boolean;
  ai_employees_unlimited: boolean;
  browser_research_enabled: boolean;
  gateway_search_enabled: boolean;
  team_features_enabled: boolean;
  admin_controls_enabled: boolean;
  priority_support: boolean;
  allowed_intelligence_tiers: string[];
  entitlements: Record<string, unknown>;
};

type EditableState = {
  display_name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  weekly_work_hours: number;
  is_active: boolean;
  browser_research_enabled: boolean;
  gateway_search_enabled: boolean;
  team_features_enabled: boolean;
  admin_controls_enabled: boolean;
  priority_support: boolean;
};

function seatBadge(unlimited: boolean) {
  return unlimited ? (
    <AdminHealthBadge tone="healthy" label="Unlimited" />
  ) : (
    <AdminHealthBadge tone="unknown" label="Capped" />
  );
}

export default function AdminPlansPage() {
  const { data, loading, error, refresh } = useAdminData<{ plans: PlanRow[] }>("/api/admin/plans");
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [form, setForm] = useState<EditableState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEditor = (plan: PlanRow) => {
    setEditing(plan);
    setSaveError(null);
    setForm({
      display_name: plan.display_name,
      monthly_price_cents: plan.monthly_price_cents,
      annual_price_cents: plan.annual_price_cents,
      weekly_work_hours: plan.weekly_work_hours,
      is_active: plan.is_active,
      browser_research_enabled: plan.browser_research_enabled,
      gateway_search_enabled: plan.gateway_search_enabled,
      team_features_enabled: plan.team_features_enabled,
      admin_controls_enabled: plan.admin_controls_enabled,
      priority_support: plan.priority_support,
    });
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(null);
  };

  const save = async () => {
    if (!editing || !form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/plans", {
        method: "PUT",
        headers,
        body: JSON.stringify({ planSlug: editing.plan_slug, updates: form }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status}).`);
      closeEditor();
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const columns: AdminColumn<PlanRow>[] = [
    { key: "slug", header: "Plan", render: (p) => <span className="font-medium text-ink">{p.display_name}</span> },
    { key: "slugId", header: "Slug", render: (p) => <span className="font-mono text-xs">{p.plan_slug}</span> },
    { key: "monthly", header: "Monthly", align: "right", render: (p) => `$${(p.monthly_price_cents / 100).toFixed(0)}` },
    { key: "annual", header: "Annual", align: "right", render: (p) => (p.annual_price_cents ? `$${(p.annual_price_cents / 100).toFixed(0)}` : "—") },
    { key: "hours", header: "Work Hrs/wk", align: "right", render: (p) => (p.weekly_work_hours > 0 ? p.weekly_work_hours : "Custom") },
    { key: "humans", header: "Humans", render: (p) => seatBadge(p.human_members_unlimited) },
    { key: "employees", header: "AI Employees", render: (p) => seatBadge(p.ai_employees_unlimited) },
    {
      key: "browser",
      header: "Browser",
      render: (p) => (
        <AdminHealthBadge tone={p.browser_research_enabled ? "healthy" : "disabled"} label={p.browser_research_enabled ? "Yes" : "No"} />
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (p) => <AdminHealthBadge tone={p.is_active ? "healthy" : "disabled"} label={p.is_active ? "Active" : "Inactive"} />,
    },
    {
      key: "edit",
      header: "",
      align: "right",
      render: (p) => (
        <Button size="sm" variant="ghost" onClick={() => openEditor(p)}>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Plans"
        subtitle="Commercial plan configs. Humans and AI employees are unlimited on every plan; plans meter weekly AI Work Hours."
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

      <Modal open={Boolean(editing)} onClose={closeEditor} size="lg">
        {editing && form && (
          <>
            <ModalHeader
              title={`Edit ${editing.display_name}`}
              subtitle={editing.plan_slug}
              onClose={closeEditor}
              icon={<ListChecks className="h-5 w-5" />}
            />
            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Display name">
                  <TextInput value={form.display_name} onChange={(v) => setForm({ ...form, display_name: v })} />
                </Field>
                <Field label="Weekly AI Work Hours (0 = unlimited)">
                  <NumberInput value={form.weekly_work_hours} onChange={(v) => setForm({ ...form, weekly_work_hours: v })} />
                </Field>
                <Field label="Monthly price (USD)">
                  <NumberInput
                    value={Math.round(form.monthly_price_cents / 100)}
                    onChange={(v) => setForm({ ...form, monthly_price_cents: Math.round(v * 100) })}
                  />
                </Field>
                <Field label="Annual price (USD)">
                  <NumberInput
                    value={Math.round(form.annual_price_cents / 100)}
                    onChange={(v) => setForm({ ...form, annual_price_cents: Math.round(v * 100) })}
                  />
                </Field>
              </div>

              <div className="space-y-3 rounded-xl border border-border-2 p-4">
                <ToggleRow label="Active" checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
                <ToggleRow label="Browser research" checked={form.browser_research_enabled} onChange={(v) => setForm({ ...form, browser_research_enabled: v })} />
                <ToggleRow label="Gateway web search" checked={form.gateway_search_enabled} onChange={(v) => setForm({ ...form, gateway_search_enabled: v })} />
                <ToggleRow label="Team controls" checked={form.team_features_enabled} onChange={(v) => setForm({ ...form, team_features_enabled: v })} />
                <ToggleRow label="Admin controls" checked={form.admin_controls_enabled} onChange={(v) => setForm({ ...form, admin_controls_enabled: v })} />
                <ToggleRow label="Priority support" checked={form.priority_support} onChange={(v) => setForm({ ...form, priority_support: v })} />
              </div>

              <p className="text-xs text-ink-3">
                Intelligence tiers: {editing.allowed_intelligence_tiers.join(", ") || "—"}. Human members and AI employees
                remain unlimited on every plan.
              </p>

              {saveError && <p className="text-sm text-danger">{saveError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-2 px-6 py-4">
              <Button variant="outline" onClick={closeEditor} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-3">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
    />
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
    />
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-2">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
