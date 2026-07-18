"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Card, Modal, ModalHeader, Toggle } from "@/components/ui";
import { authHeaders } from "@/lib/api/auth-client";
import {
  AdminAsync,
  AdminHealthBadge,
  AdminPageHeader,
  useAdminData,
} from "@/components/admin/common";
import { ListChecks, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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
  catalogVersion?: number | null;
  revolutReady?: boolean;
  syncStatuses?: string[];
  priceIdsNeedingSync?: string[];
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

function bytesToGb(bytes: number | null): number | null {
  if (bytes == null || bytes <= 0) return null;
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100;
}

const TABS = [
  { id: "catalog", label: "Catalog" },
  { id: "promos", label: "Promos" },
  { id: "ops", label: "Ops" },
] as const;

export default function AdminPlansPage() {
  const { data, loading, error, refresh } = useAdminData<{ plans: PlanRow[] }>("/api/admin/plans");
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("catalog");
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [form, setForm] = useState<EditableState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishNotes, setPublishNotes] = useState<string[] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [syncingSlug, setSyncingSlug] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const syncPlanToRevolut = async (plan: PlanRow) => {
    const ids = plan.priceIdsNeedingSync ?? [];
    if (ids.length === 0) {
      setSyncMessage(`${plan.display_name} is already checkout-ready.`);
      return;
    }
    setSyncingSlug(plan.plan_slug);
    setSyncMessage(null);
    const results: string[] = [];
    try {
      for (const priceId of ids) {
        const res = await fetch("/api/admin/commerce", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({
            action: "sync_price",
            priceId,
            reason: `Plans hub sync for ${plan.plan_slug}`,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || json.ok === false) {
          results.push(json.error ?? `Failed for ${priceId.slice(0, 8)}`);
        } else {
          results.push("ok");
        }
      }
      const failed = results.filter((r) => r !== "ok");
      if (failed.length === 0) {
        setSyncMessage(`${plan.display_name}: Revolut sync succeeded — checkout ready.`);
      } else {
        setSyncMessage(
          `${plan.display_name}: sync issues — ${failed.join("; ")}. Marketing prices stay live; paid checkout needs a successful sync.`,
        );
      }
      await refresh();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Revolut sync failed.");
    } finally {
      setSyncingSlug(null);
    }
  };

  const openEditor = (plan: PlanRow) => {
    setEditing(plan);
    setSaveError(null);
    setPublishNotes(null);
    setConfirmText("");
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
    setConfirmText("");
  };

  const priceChanged =
    editing &&
    form &&
    (form.monthly_price_cents !== editing.monthly_price_cents ||
      form.annual_price_cents !== editing.annual_price_cents ||
      form.weekly_work_hours !== editing.weekly_work_hours);

  const save = async () => {
    if (!editing || !form) return;
    if (priceChanged && confirmText.trim().toLowerCase() !== "publish") {
      setSaveError('Type "publish" to confirm a live price or Work Hours change.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setPublishNotes(null);

    let entitlements: Record<string, unknown>;
    try {
      const parsed = form.entitlements_json.trim() ? JSON.parse(form.entitlements_json) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Entitlements must be a JSON object.");
      }
      entitlements = parsed as Record<string, unknown>;
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? `Invalid entitlements JSON: ${err.message}`
          : "Invalid entitlements JSON.",
      );
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
        body: JSON.stringify({
          planSlug: editing.plan_slug,
          updates,
          reason: "admin_plans_publish_live",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status}).`);
      setPublishNotes(
        Array.isArray(body.notes) && body.notes.length
          ? body.notes
          : ["Published live to customer surfaces."],
      );
      await refresh();
      setTimeout(() => closeEditor(), 1600);
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

  const plans = data?.plans ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Plans"
        subtitle="Edit list prices, Work Hours, and entitlements. Save & publish updates marketing, checkout, and settings immediately. Existing paid subscribers keep their current price until renewal."
        icon={<ListChecks className="h-5 w-5" />}
      />

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.id ? "bg-accent-soft text-accent-d" : "text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {syncMessage ? (
        <Card className="mb-4 p-3 text-sm text-ink-2">{syncMessage}</Card>
      ) : null}

      {tab === "promos" && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-ink">Promo codes</h2>
          <p className="mt-1 text-sm text-ink-3">
            Manage discount codes and trial boosts on the dedicated promo page.
          </p>
          <Link
            href="/admin/promo-codes"
            className="mt-4 inline-flex rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white"
          >
            Open promo codes →
          </Link>
        </Card>
      )}

      {tab === "ops" && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-ink">Commerce ops</h2>
          <p className="mt-1 text-sm text-ink-3">
            Revolut sync, subscription inspector, cutover tools, and commerce audit trail.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/admin/commerce"
              className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent-d"
            >
              Open commerce ops →
            </Link>
            <Link
              href="/admin/billing"
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-ink-2"
            >
              Billing / subscriptions →
            </Link>
            <Link
              href="/admin/economics"
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-ink-2"
            >
              Economics →
            </Link>
          </div>
        </Card>
      )}

      {tab === "catalog" && (
        <AdminAsync loading={loading} error={error}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => {
              const isEnterprise = plan.plan_slug === "enterprise";
              const isFree = plan.plan_slug === "free";
              return (
                <Card key={plan.plan_slug} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-ink">{plan.display_name}</h3>
                      <p className="font-mono text-[11px] text-ink-3">{plan.plan_slug}</p>
                    </div>
                    <AdminHealthBadge
                      tone={plan.is_active ? "healthy" : "disabled"}
                      label={plan.is_active ? "Live" : "Off"}
                    />
                  </div>

                  <p className="mt-4 text-2xl font-semibold tabular-nums text-ink">
                    {isEnterprise
                      ? "Custom"
                      : isFree
                        ? "$0"
                        : `$${(plan.monthly_price_cents / 100).toFixed(0)}`}
                    {!isEnterprise && !isFree && (
                      <span className="text-sm font-normal text-ink-3">/mo</span>
                    )}
                  </p>
                  {!isEnterprise && !isFree && plan.annual_price_cents > 0 && (
                    <p className="text-xs text-ink-3">
                      ${(plan.annual_price_cents / 100).toFixed(0)}/yr
                    </p>
                  )}

                  <ul className="mt-4 flex-1 space-y-1.5 text-xs text-ink-2">
                    <li>
                      {plan.weekly_work_hours > 0
                        ? `${plan.weekly_work_hours} AI Work Hours / week`
                        : "Custom / unlimited WH"}
                    </li>
                    <li>
                      Humans: {plan.human_members_unlimited ? "unlimited" : plan.max_members ?? "—"}
                    </li>
                    <li>
                      AI employees:{" "}
                      {plan.ai_employees_unlimited ? "unlimited" : plan.max_ai_employees ?? "—"}
                    </li>
                    <li>
                      Catalog v{plan.catalogVersion ?? "—"} ·{" "}
                      {plan.revolutReady ? (
                        <span className="text-emerald-700">Checkout ready</span>
                      ) : (
                        <span className="text-amber-700">
                          Marketing live · checkout needs Revolut sync
                        </span>
                      )}
                    </li>
                  </ul>

                  <div className="mt-4 flex flex-col gap-2">
                    {!plan.revolutReady &&
                    (plan.priceIdsNeedingSync?.length ?? 0) > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full"
                        disabled={syncingSlug === plan.plan_slug}
                        onClick={() => void syncPlanToRevolut(plan)}
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            syncingSlug === plan.plan_slug && "animate-spin",
                          )}
                        />
                        {syncingSlug === plan.plan_slug
                          ? "Syncing…"
                          : "Sync to Revolut"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => openEditor(plan)}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit & publish
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </AdminAsync>
      )}

      <Modal open={Boolean(editing)} onClose={closeEditor} size="lg">
        {editing && form && (
          <>
            <ModalHeader
              title={`Edit ${editing.display_name}`}
              subtitle={`${editing.plan_slug} · Save publishes live to customers`}
              onClose={closeEditor}
              icon={<Sparkles className="h-5 w-5" />}
            />
            <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
              <p className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
                New checkouts and marketing update now. Existing paid subscribers keep their current
                provider price until renewal.
              </p>

              <Section title="Pricing & trial">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Display name">
                    <TextInput
                      value={form.display_name}
                      onChange={(v) => setForm({ ...form, display_name: v })}
                    />
                  </Field>
                  <Field label="Trial days">
                    <NumberInput
                      value={form.trial_days}
                      onChange={(v) => setForm({ ...form, trial_days: v })}
                    />
                  </Field>
                  <Field label="Monthly price (USD)">
                    <NumberInput
                      value={Math.round(form.monthly_price_cents / 100)}
                      onChange={(v) =>
                        setForm({ ...form, monthly_price_cents: Math.round(v * 100) })
                      }
                    />
                  </Field>
                  <Field label="Annual price (USD)">
                    <NumberInput
                      value={Math.round(form.annual_price_cents / 100)}
                      onChange={(v) =>
                        setForm({ ...form, annual_price_cents: Math.round(v * 100) })
                      }
                    />
                  </Field>
                </div>
              </Section>

              <Section
                title="Capacity & limits"
                hint="Leave a limit blank for unlimited. Weekly AI Work Hours = 0 means unlimited."
              >
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Weekly AI Work Hours (0 = unlimited)">
                    <NumberInput
                      value={form.weekly_work_hours}
                      onChange={(v) => setForm({ ...form, weekly_work_hours: v })}
                    />
                  </Field>
                  <Field label="Max workspaces">
                    <NullableNumberInput
                      value={form.max_workspaces}
                      onChange={(v) => setForm({ ...form, max_workspaces: v })}
                    />
                  </Field>
                  <Field label="Max rooms">
                    <NullableNumberInput
                      value={form.max_rooms}
                      onChange={(v) => setForm({ ...form, max_rooms: v })}
                    />
                  </Field>
                  <Field label="Max topics">
                    <NullableNumberInput
                      value={form.max_topics}
                      onChange={(v) => setForm({ ...form, max_topics: v })}
                    />
                  </Field>
                  <Field label="Storage (GB)">
                    <NullableNumberInput
                      value={form.max_storage_gb}
                      onChange={(v) => setForm({ ...form, max_storage_gb: v })}
                    />
                  </Field>
                  <Field label="Max file upload (MB)">
                    <NullableNumberInput
                      value={form.max_file_upload_mb}
                      onChange={(v) => setForm({ ...form, max_file_upload_mb: v })}
                    />
                  </Field>
                  <Field label="Max browser runs / week">
                    <NullableNumberInput
                      value={form.max_browser_runs_per_week}
                      onChange={(v) => setForm({ ...form, max_browser_runs_per_week: v })}
                    />
                  </Field>
                </div>
              </Section>

              <Section title="Seats">
                <div className="space-y-3 rounded-xl border border-border-2 p-4">
                  <ToggleRow
                    label="Unlimited human members"
                    checked={form.human_members_unlimited}
                    onChange={(v) => setForm({ ...form, human_members_unlimited: v })}
                  />
                  {!form.human_members_unlimited && (
                    <Field label="Max human members">
                      <NullableNumberInput
                        value={form.max_members}
                        onChange={(v) => setForm({ ...form, max_members: v })}
                      />
                    </Field>
                  )}
                  <ToggleRow
                    label="Unlimited AI employees"
                    checked={form.ai_employees_unlimited}
                    onChange={(v) => setForm({ ...form, ai_employees_unlimited: v })}
                  />
                  {!form.ai_employees_unlimited && (
                    <Field label="Max AI employees">
                      <NullableNumberInput
                        value={form.max_ai_employees}
                        onChange={(v) => setForm({ ...form, max_ai_employees: v })}
                      />
                    </Field>
                  )}
                </div>
              </Section>

              <Section title="Feature entitlements">
                <div className="space-y-3 rounded-xl border border-border-2 p-4">
                  <ToggleRow
                    label="Active (visible for purchase)"
                    checked={form.is_active}
                    onChange={(v) => setForm({ ...form, is_active: v })}
                  />
                  <ToggleRow
                    label="Browser research"
                    checked={form.browser_research_enabled}
                    onChange={(v) => setForm({ ...form, browser_research_enabled: v })}
                  />
                  <ToggleRow
                    label="Gateway web search"
                    checked={form.gateway_search_enabled}
                    onChange={(v) => setForm({ ...form, gateway_search_enabled: v })}
                  />
                  <ToggleRow
                    label="Custom AI employees"
                    checked={form.custom_ai_employees_enabled}
                    onChange={(v) => setForm({ ...form, custom_ai_employees_enabled: v })}
                  />
                  <ToggleRow
                    label="Team controls"
                    checked={form.team_features_enabled}
                    onChange={(v) => setForm({ ...form, team_features_enabled: v })}
                  />
                  <ToggleRow
                    label="Admin controls"
                    checked={form.admin_controls_enabled}
                    onChange={(v) => setForm({ ...form, admin_controls_enabled: v })}
                  />
                  <ToggleRow
                    label="Priority support"
                    checked={form.priority_support}
                    onChange={(v) => setForm({ ...form, priority_support: v })}
                  />
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

              <Section
                title="Entitlements (raw JSON)"
                hint="Customer-facing tier labels and custom flags."
              >
                <textarea
                  value={form.entitlements_json}
                  onChange={(e) => setForm({ ...form, entitlements_json: e.target.value })}
                  spellCheck={false}
                  rows={6}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
                />
              </Section>

              {priceChanged && (
                <Field label='Type "publish" to confirm live price / WH change'>
                  <TextInput value={confirmText} onChange={setConfirmText} />
                </Field>
              )}

              {saveError && <p className="text-sm text-danger">{saveError}</p>}
              {publishNotes && (
                <ul className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {publishNotes.map((n) => (
                    <li key={n}>✓ {n}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-2 px-6 py-4">
              <Button variant="outline" onClick={closeEditor} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Publishing…" : "Save & publish live"}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
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

function NullableNumberInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
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

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-2">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
