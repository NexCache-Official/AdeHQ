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

const INTELLIGENCE_TIERS = [
  "cheap",
  "balanced",
  "strong",
  "long_context",
  "coding",
  "creative",
] as const;

const BYTES_PER_GB = 1024 ** 3;

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
  max_ai_employees: number | null;
  max_members: number | null;
  max_workspaces: number | null;
  max_rooms: number | null;
  max_topics: number | null;
  max_storage_bytes: number | null;
  max_browser_runs_per_week: number | null;
  max_file_upload_mb: number | null;
  browser_research_enabled: boolean;
  gateway_search_enabled: boolean;
  custom_ai_employees_enabled: boolean;
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
  trial_days: number;
  is_active: boolean;
  weekly_work_hours: number;
  human_members_unlimited: boolean;
  ai_employees_unlimited: boolean;
  max_ai_employees: number | null;
  max_members: number | null;
  max_workspaces: number | null;
  max_rooms: number | null;
  max_topics: number | null;
  max_storage_gb: number | null;
  max_browser_runs_per_week: number | null;
  max_file_upload_mb: number | null;
  browser_research_enabled: boolean;
  gateway_search_enabled: boolean;
  custom_ai_employees_enabled: boolean;
  team_features_enabled: boolean;
  admin_controls_enabled: boolean;
  priority_support: boolean;
  allowed_intelligence_tiers: string[];
  entitlements_json: string;
};

function seatBadge(unlimited: boolean) {
  return unlimited ? (
    <AdminHealthBadge tone="healthy" label="Unlimited" />
  ) : (
    <AdminHealthBadge tone="unknown" label="Capped" />
  );
}

function bytesToGb(bytes: number | null): number | null {
  if (bytes == null || bytes <= 0) return null;
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100;
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
      trial_days: plan.trial_days,
      is_active: plan.is_active,
      weekly_work_hours: plan.weekly_work_hours,
      human_members_unlimited: plan.human_members_unlimited,
      ai_employees_unlimited: plan.ai_employees_unlimited,
      max_ai_employees: plan.max_ai_employees,
      max_members: plan.max_members,
      max_workspaces: plan.max_workspaces,
      max_rooms: plan.max_rooms,
      max_topics: plan.max_topics,
      max_storage_gb: bytesToGb(plan.max_storage_bytes),
      max_browser_runs_per_week: plan.max_browser_runs_per_week,
      max_file_upload_mb: plan.max_file_upload_mb,
      browser_research_enabled: plan.browser_research_enabled,
      gateway_search_enabled: plan.gateway_search_enabled,
      custom_ai_employees_enabled: plan.custom_ai_employees_enabled,
      team_features_enabled: plan.team_features_enabled,
      admin_controls_enabled: plan.admin_controls_enabled,
      priority_support: plan.priority_support,
      allowed_intelligence_tiers: [...(plan.allowed_intelligence_tiers ?? [])],
      entitlements_json: JSON.stringify(plan.entitlements ?? {}, null, 2),
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

    let entitlements: Record<string, unknown>;
    try {
      const parsed = form.entitlements_json.trim() ? JSON.parse(form.entitlements_json) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Entitlements must be a JSON object.");
      }
      entitlements = parsed as Record<string, unknown>;
    } catch (err) {
      setSaveError(err instanceof Error ? `Invalid entitlements JSON: ${err.message}` : "Invalid entitlements JSON.");
      setSaving(false);
      return;
    }

    const updates = {
      display_name: form.display_name,
      monthly_price_cents: form.monthly_price_cents,
      annual_price_cents: form.annual_price_cents,
      trial_days: form.trial_days,
      is_active: form.is_active,
      weekly_work_hours: form.weekly_work_hours,
      human_members_unlimited: form.human_members_unlimited,
      ai_employees_unlimited: form.ai_employees_unlimited,
      max_ai_employees: form.max_ai_employees,
      max_members: form.max_members,
      max_workspaces: form.max_workspaces,
      max_rooms: form.max_rooms,
      max_topics: form.max_topics,
      max_storage_bytes:
        form.max_storage_gb != null && form.max_storage_gb > 0
          ? Math.round(form.max_storage_gb * BYTES_PER_GB)
          : null,
      max_browser_runs_per_week: form.max_browser_runs_per_week,
      max_file_upload_mb: form.max_file_upload_mb,
      browser_research_enabled: form.browser_research_enabled,
      gateway_search_enabled: form.gateway_search_enabled,
      custom_ai_employees_enabled: form.custom_ai_employees_enabled,
      team_features_enabled: form.team_features_enabled,
      admin_controls_enabled: form.admin_controls_enabled,
      priority_support: form.priority_support,
      allowed_intelligence_tiers: form.allowed_intelligence_tiers,
      entitlements,
    };

    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/plans", {
        method: "PUT",
        headers,
        body: JSON.stringify({ planSlug: editing.plan_slug, updates }),
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

  const toggleTier = (tier: string) => {
    if (!form) return;
    const has = form.allowed_intelligence_tiers.includes(tier);
    setForm({
      ...form,
      allowed_intelligence_tiers: has
        ? form.allowed_intelligence_tiers.filter((t) => t !== tier)
        : [...form.allowed_intelligence_tiers, tier],
    });
  };

  const columns: AdminColumn<PlanRow>[] = [
    { key: "slug", header: "Plan", render: (p) => <span className="font-medium text-ink">{p.display_name}</span> },
    { key: "slugId", header: "Slug", render: (p) => <span className="font-mono text-xs">{p.plan_slug}</span> },
    { key: "monthly", header: "Monthly", align: "right", render: (p) => `$${(p.monthly_price_cents / 100).toFixed(0)}` },
    { key: "annual", header: "Annual", align: "right", render: (p) => (p.annual_price_cents ? `$${(p.annual_price_cents / 100).toFixed(0)}` : "—") },
    { key: "hours", header: "Work Hrs/wk", align: "right", render: (p) => (p.weekly_work_hours > 0 ? p.weekly_work_hours : "Custom") },
    { key: "storage", header: "Storage", align: "right", render: (p) => (bytesToGb(p.max_storage_bytes) != null ? `${bytesToGb(p.max_storage_bytes)} GB` : "∞") },
    {
      key: "browser",
      header: "Browser",
      render: (p) => (
        <AdminHealthBadge tone={p.browser_research_enabled ? "healthy" : "disabled"} label={p.browser_research_enabled ? "Yes" : "No"} />
      ),
    },
    {
      key: "search",
      header: "Search",
      render: (p) => (
        <AdminHealthBadge tone={p.gateway_search_enabled ? "healthy" : "disabled"} label={p.gateway_search_enabled ? "Yes" : "No"} />
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
        subtitle="Full control of every commercial plan: pricing, weekly AI Work Hours, capacity caps, feature entitlements, and intelligence tiers. Changes apply to every workspace on the plan."
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
            <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
              <Section title="Pricing & trial">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Display name">
                    <TextInput value={form.display_name} onChange={(v) => setForm({ ...form, display_name: v })} />
                  </Field>
                  <Field label="Trial days">
                    <NumberInput value={form.trial_days} onChange={(v) => setForm({ ...form, trial_days: v })} />
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
              </Section>

              <Section title="Capacity & limits" hint="Leave a limit blank for unlimited. Weekly AI Work Hours = 0 means unlimited.">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Weekly AI Work Hours (0 = unlimited)">
                    <NumberInput value={form.weekly_work_hours} onChange={(v) => setForm({ ...form, weekly_work_hours: v })} />
                  </Field>
                  <Field label="Max workspaces">
                    <NullableNumberInput value={form.max_workspaces} onChange={(v) => setForm({ ...form, max_workspaces: v })} />
                  </Field>
                  <Field label="Max rooms">
                    <NullableNumberInput value={form.max_rooms} onChange={(v) => setForm({ ...form, max_rooms: v })} />
                  </Field>
                  <Field label="Max topics">
                    <NullableNumberInput value={form.max_topics} onChange={(v) => setForm({ ...form, max_topics: v })} />
                  </Field>
                  <Field label="Storage (GB)">
                    <NullableNumberInput value={form.max_storage_gb} onChange={(v) => setForm({ ...form, max_storage_gb: v })} />
                  </Field>
                  <Field label="Max file upload (MB)">
                    <NullableNumberInput value={form.max_file_upload_mb} onChange={(v) => setForm({ ...form, max_file_upload_mb: v })} />
                  </Field>
                  <Field label="Max browser runs / week">
                    <NullableNumberInput value={form.max_browser_runs_per_week} onChange={(v) => setForm({ ...form, max_browser_runs_per_week: v })} />
                  </Field>
                </div>
              </Section>

              <Section title="Seats">
                <div className="space-y-3 rounded-xl border border-border-2 p-4">
                  <ToggleRow label="Unlimited human members" checked={form.human_members_unlimited} onChange={(v) => setForm({ ...form, human_members_unlimited: v })} />
                  {!form.human_members_unlimited && (
                    <Field label="Max human members">
                      <NullableNumberInput value={form.max_members} onChange={(v) => setForm({ ...form, max_members: v })} />
                    </Field>
                  )}
                  <ToggleRow label="Unlimited AI employees" checked={form.ai_employees_unlimited} onChange={(v) => setForm({ ...form, ai_employees_unlimited: v })} />
                  {!form.ai_employees_unlimited && (
                    <Field label="Max AI employees">
                      <NullableNumberInput value={form.max_ai_employees} onChange={(v) => setForm({ ...form, max_ai_employees: v })} />
                    </Field>
                  )}
                </div>
              </Section>

              <Section title="Feature entitlements" hint="These gate paid features across every workspace on this plan.">
                <div className="space-y-3 rounded-xl border border-border-2 p-4">
                  <ToggleRow label="Active (visible for purchase)" checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
                  <ToggleRow label="Browser research" checked={form.browser_research_enabled} onChange={(v) => setForm({ ...form, browser_research_enabled: v })} />
                  <ToggleRow label="Gateway web search" checked={form.gateway_search_enabled} onChange={(v) => setForm({ ...form, gateway_search_enabled: v })} />
                  <ToggleRow label="Custom AI employees" checked={form.custom_ai_employees_enabled} onChange={(v) => setForm({ ...form, custom_ai_employees_enabled: v })} />
                  <ToggleRow label="Team controls" checked={form.team_features_enabled} onChange={(v) => setForm({ ...form, team_features_enabled: v })} />
                  <ToggleRow label="Admin controls" checked={form.admin_controls_enabled} onChange={(v) => setForm({ ...form, admin_controls_enabled: v })} />
                  <ToggleRow label="Priority support" checked={form.priority_support} onChange={(v) => setForm({ ...form, priority_support: v })} />
                </div>
              </Section>

              <Section title="Allowed intelligence tiers">
                <div className="flex flex-wrap gap-2">
                  {INTELLIGENCE_TIERS.map((tier) => {
                    const active = form.allowed_intelligence_tiers.includes(tier);
                    return (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => toggleTier(tier)}
                        className={
                          active
                            ? "rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs font-medium text-accent-d"
                            : "rounded-full border border-border-2 px-3 py-1 text-xs font-medium text-ink-3 hover:bg-muted"
                        }
                      >
                        {tier}
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section title="Entitlements (raw JSON)" hint="Customer-facing tier labels and custom flags. Must be a JSON object.">
                <textarea
                  value={form.entitlements_json}
                  onChange={(e) => setForm({ ...form, entitlements_json: e.target.value })}
                  spellCheck={false}
                  rows={8}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
                />
              </Section>

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

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      {children}
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

function NullableNumberInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      placeholder="Unlimited"
      onChange={(e) => {
        const raw = e.target.value.trim();
        onChange(raw === "" ? null : Number(raw));
      }}
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
