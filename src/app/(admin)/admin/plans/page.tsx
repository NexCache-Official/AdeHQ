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
import { ListChecks, Pencil, Plus, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const PLAN_SLUG_RE = /^[a-z][a-z0-9_]{1,31}$/;

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
  monthly_live_call_minutes: number | null;
  standard_tts_internal_usd_per_call: number;
  standard_tts_treatment: "internal_only" | "platform_absorbed" | "customer_charged";
  premium_tts_treatment: "internal_only" | "platform_absorbed" | "customer_charged";
  stt_treatment: "internal_only" | "platform_absorbed" | "customer_charged";
  transcript_included: boolean;
  captions_included: boolean;
  entitlements_json: string;
};

function bytesToGb(bytes: number | null): number | null {
  if (bytes == null || bytes <= 0) return null;
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100;
}

function voiceEntitlements(plan: PlanRow) {
  const voice =
    plan.entitlements?.voice && typeof plan.entitlements.voice === "object"
      ? (plan.entitlements.voice as Record<string, unknown>)
      : {};
  const launchDefault =
    plan.plan_slug === "enterprise"
      ? null
      : ({ free: 0, pro: 120, team: 500, business: 2000 } as Record<string, number>)[
          plan.plan_slug
        ] ?? 0;
  const treatment = (
    value: unknown,
    fallback: "internal_only" | "platform_absorbed" | "customer_charged",
  ) =>
    value === "internal_only" ||
    value === "platform_absorbed" ||
    value === "customer_charged"
      ? value
      : fallback;
  return {
    monthly_live_call_minutes:
      voice.monthly_live_call_minutes === null
        ? null
        : Number(voice.monthly_live_call_minutes ?? launchDefault),
    standard_tts_internal_usd_per_call: Number(
      voice.standard_tts_internal_usd_per_call ?? 0.02,
    ),
    standard_tts_treatment: treatment(
      voice.standard_tts_treatment,
      "platform_absorbed",
    ),
    premium_tts_treatment: treatment(
      voice.premium_tts_treatment,
      "customer_charged",
    ),
    stt_treatment: treatment(voice.stt_treatment, "platform_absorbed"),
    transcript_included: voice.transcript_included !== false,
    captions_included: voice.captions_included !== false,
  };
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
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    planSlug: "",
    displayName: "",
    duplicateFrom: "pro",
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    weeklyWorkHours: 125,
    isActive: true,
    confirmText: "",
  });
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNotes, setCreateNotes] = useState<string[] | null>(null);

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
      ...voiceEntitlements(plan),
      entitlements_json: JSON.stringify(plan.entitlements ?? {}, null, 2),
    });
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(null);
    setConfirmText("");
  };

  const openCreate = () => {
    const defaultFrom = (data?.plans ?? []).some((p) => p.plan_slug === "pro")
      ? "pro"
      : (data?.plans?.[0]?.plan_slug ?? "free");
    const source = (data?.plans ?? []).find((p) => p.plan_slug === defaultFrom);
    setCreating(true);
    setCreateError(null);
    setCreateNotes(null);
    setCreateForm({
      planSlug: "",
      displayName: "",
      duplicateFrom: defaultFrom,
      monthlyPriceUsd: source ? Math.round(source.monthly_price_cents / 100) : 0,
      annualPriceUsd: source ? Math.round(source.annual_price_cents / 100) : 0,
      weeklyWorkHours: source?.weekly_work_hours ?? 125,
      isActive: true,
      confirmText: "",
    });
  };

  const closeCreate = () => {
    setCreating(false);
    setCreateError(null);
    setCreateNotes(null);
  };

  const createAndPublish = async () => {
    const slug = createForm.planSlug.trim().toLowerCase();
    const name = createForm.displayName.trim();
    if (!slug || !name) {
      setCreateError("Slug and display name are required.");
      return;
    }
    if (!PLAN_SLUG_RE.test(slug)) {
      setCreateError(
        "Invalid slug. Use 2–32 chars: start with a letter, then lowercase letters, digits, or underscore.",
      );
      return;
    }
    const paid =
      createForm.monthlyPriceUsd > 0 || createForm.annualPriceUsd > 0;
    if (paid && createForm.confirmText.trim().toLowerCase() !== "publish") {
      setCreateError('Type "publish" to confirm Create & publish live.');
      return;
    }

    setCreateSaving(true);
    setCreateError(null);
    setCreateNotes(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/plans", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planSlug: slug,
          displayName: name,
          duplicateFrom: createForm.duplicateFrom || undefined,
          monthlyPriceCents: Math.round(createForm.monthlyPriceUsd * 100),
          annualPriceCents: Math.round(createForm.annualPriceUsd * 100),
          weeklyWorkHours: Number(createForm.weeklyWorkHours) || 0,
          isActive: createForm.isActive,
          reason: "admin_plans_create_publish",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        notes?: string[];
        revolutSynced?: boolean;
      };
      if (!res.ok && !body.notes) {
        throw new Error(body?.error ?? `Create failed (${res.status}).`);
      }
      if (body.error && !body.notes) {
        throw new Error(body.error);
      }
      setCreateNotes(
        Array.isArray(body.notes) && body.notes.length
          ? body.notes
          : ["Plan created and published live."],
      );
      setSyncMessage(
        body.revolutSynced === false
          ? `${name}: published for marketing — Revolut sync still needed for checkout.`
          : `${name}: created and published (marketing + Revolut).`,
      );
      await refresh();
      setTimeout(() => closeCreate(), 1600);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setCreateSaving(false);
    }
  };

  const priceChanged = Boolean(
    editing &&
      form &&
      (Number(form.monthly_price_cents) !== Number(editing.monthly_price_cents) ||
        Number(form.annual_price_cents) !== Number(editing.annual_price_cents) ||
        Number(form.weekly_work_hours) !== Number(editing.weekly_work_hours)),
  );
  const confirmOk = !priceChanged || confirmText.trim().toLowerCase() === "publish";

  const save = async () => {
    if (!editing || !form) {
      setSaveError("Editor is not ready — close and reopen the plan.");
      return;
    }
    if (!confirmOk) {
      setSaveError('Type "publish" in the confirmation box below, then click Save again.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setPublishNotes(null);

    let entitlements: Record<string, unknown>;
    try {
      const raw = form.entitlements_json.trim();
      const parsed = raw ? JSON.parse(raw) : {};
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Entitlements must be a JSON object.");
      }
      entitlements = {
        ...(parsed as Record<string, unknown>),
        voice: {
          ...((parsed as Record<string, unknown>).voice &&
          typeof (parsed as Record<string, unknown>).voice === "object"
            ? ((parsed as Record<string, unknown>).voice as Record<string, unknown>)
            : {}),
          monthly_live_call_minutes: form.monthly_live_call_minutes,
          standard_tts_internal_usd_per_call:
            form.standard_tts_internal_usd_per_call,
          standard_tts_customer_wh_per_call: 0,
          standard_tts_treatment: form.standard_tts_treatment,
          premium_tts_treatment: form.premium_tts_treatment,
          stt_treatment: form.stt_treatment,
          transcript_included: form.transcript_included,
          captions_included: form.captions_included,
        },
      };
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
      monthly_price_cents: Number(form.monthly_price_cents) || 0,
      annual_price_cents: Number(form.annual_price_cents) || 0,
      trial_days: Number(form.trial_days) || 0,
      is_active: form.is_active,
      weekly_work_hours: Number(form.weekly_work_hours) || 0,
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
      allowed_intelligence_tiers: form.allowed_intelligence_tiers ?? [],
      entitlements,
    };

    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/plans", {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planSlug: editing.plan_slug,
          updates,
          reason: "admin_plans_publish_live",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        notes?: string[];
        ok?: boolean;
      };
      if (!res.ok) {
        throw new Error(body?.error ?? `Save failed (${res.status}).`);
      }
      setPublishNotes(
        Array.isArray(body.notes) && body.notes.length
          ? body.notes
          : ["Published live to customer surfaces."],
      );
      await refresh();
      setTimeout(() => closeEditor(), 1800);
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
        actions={
          tab === "catalog" ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New plan
            </Button>
          ) : null
        }
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
          <div className="mb-4 flex justify-end sm:hidden">
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New plan
            </Button>
          </div>
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
                      Live calls:{" "}
                      {voiceEntitlements(plan).monthly_live_call_minutes == null
                        ? "contracted"
                        : `${voiceEntitlements(plan).monthly_live_call_minutes} min / month`}
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

      <Modal open={creating} onClose={closeCreate} size="md">
        <>
          <ModalHeader
            title="New plan"
            subtitle="Duplicate entitlements, set price & Work Hours, then publish marketing + Revolut in one step."
            onClose={closeCreate}
            icon={<Plus className="h-5 w-5" />}
          />
          <div className="space-y-4 px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Slug (code)">
                <TextInput
                  value={createForm.planSlug}
                  onChange={(v) =>
                    setCreateForm({
                      ...createForm,
                      planSlug: v.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                    })
                  }
                />
              </Field>
              <Field label="Display name">
                <TextInput
                  value={createForm.displayName}
                  onChange={(v) => setCreateForm({ ...createForm, displayName: v })}
                />
              </Field>
              <Field label="Duplicate entitlements from">
                <select
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
                  value={createForm.duplicateFrom}
                  onChange={(e) => {
                    const slug = e.target.value;
                    const source = plans.find((p) => p.plan_slug === slug);
                    setCreateForm({
                      ...createForm,
                      duplicateFrom: slug,
                      monthlyPriceUsd: source
                        ? Math.round(source.monthly_price_cents / 100)
                        : createForm.monthlyPriceUsd,
                      annualPriceUsd: source
                        ? Math.round(source.annual_price_cents / 100)
                        : createForm.annualPriceUsd,
                      weeklyWorkHours: source?.weekly_work_hours ?? createForm.weeklyWorkHours,
                    });
                  }}
                >
                  {plans.map((p) => (
                    <option key={p.plan_slug} value={p.plan_slug}>
                      {p.display_name} ({p.plan_slug})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Weekly AI Work Hours (0 = unlimited)">
                <NumberInput
                  value={createForm.weeklyWorkHours}
                  onChange={(v) => setCreateForm({ ...createForm, weeklyWorkHours: v })}
                />
              </Field>
              <Field label="Monthly price (USD)">
                <NumberInput
                  value={createForm.monthlyPriceUsd}
                  onChange={(v) => setCreateForm({ ...createForm, monthlyPriceUsd: v })}
                />
              </Field>
              <Field label="Annual price (USD)">
                <NumberInput
                  value={createForm.annualPriceUsd}
                  onChange={(v) => setCreateForm({ ...createForm, annualPriceUsd: v })}
                />
              </Field>
            </div>
            <ToggleRow
              label="Marketing live (active)"
              checked={createForm.isActive}
              onChange={(v) => setCreateForm({ ...createForm, isActive: v })}
            />
            {createForm.monthlyPriceUsd > 0 || createForm.annualPriceUsd > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
                <p className="text-xs font-medium text-amber-900">
                  Type <span className="font-mono">publish</span> to create & publish live
                  (marketing + Revolut sync).
                </p>
                <input
                  type="text"
                  value={createForm.confirmText}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, confirmText: e.target.value })
                  }
                  placeholder='Type "publish"'
                  autoComplete="off"
                  className="mt-2 h-10 w-full rounded-xl border border-amber-300 bg-white px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
                />
              </div>
            ) : null}
            {createNotes ? (
              <ul className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                {createNotes.map((n) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            ) : null}
            {createError ? <p className="text-sm text-danger">{createError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeCreate} disabled={createSaving}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void createAndPublish()}
                disabled={
                  createSaving ||
                  ((createForm.monthlyPriceUsd > 0 || createForm.annualPriceUsd > 0) &&
                    createForm.confirmText.trim().toLowerCase() !== "publish")
                }
              >
                {createSaving ? "Publishing…" : "Create & publish live"}
              </Button>
            </div>
          </div>
        </>
      </Modal>

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

              <Section
                title="Voice economics & entitlements"
                hint="Call minutes are per session (not per AI). Standard TTS starter COGS is provider-neutral and customer WH stays zero."
              >
                <div className="grid grid-cols-2 gap-4 rounded-xl border border-border-2 p-4">
                  <Field label="Monthly live-call minutes (blank = contracted)">
                    <NullableNumberInput
                      value={form.monthly_live_call_minutes}
                      onChange={(v) =>
                        setForm({ ...form, monthly_live_call_minutes: v })
                      }
                    />
                  </Field>
                  <Field label="Standard TTS included USD / call">
                    <NumberInput
                      value={form.standard_tts_internal_usd_per_call}
                      onChange={(v) =>
                        setForm({
                          ...form,
                          standard_tts_internal_usd_per_call: Math.max(0, v),
                        })
                      }
                    />
                  </Field>
                  <Field label="Standard TTS treatment">
                    <VoiceTreatmentSelect
                      value={form.standard_tts_treatment}
                      onChange={(v) =>
                        setForm({ ...form, standard_tts_treatment: v })
                      }
                    />
                  </Field>
                  <Field label="Premium TTS treatment">
                    <VoiceTreatmentSelect
                      value={form.premium_tts_treatment}
                      onChange={(v) =>
                        setForm({ ...form, premium_tts_treatment: v })
                      }
                    />
                  </Field>
                  <Field label="Speech-to-text treatment">
                    <VoiceTreatmentSelect
                      value={form.stt_treatment}
                      onChange={(v) => setForm({ ...form, stt_treatment: v })}
                    />
                  </Field>
                  <div className="space-y-3">
                    <ToggleRow
                      label="Transcript included"
                      checked={form.transcript_included}
                      onChange={(v) =>
                        setForm({ ...form, transcript_included: v })
                      }
                    />
                    <ToggleRow
                      label="Captions included"
                      checked={form.captions_included}
                      onChange={(v) =>
                        setForm({ ...form, captions_included: v })
                      }
                    />
                  </div>
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

              {publishNotes && (
                <ul className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {publishNotes.map((n) => (
                    <li key={n}>✓ {n}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-3 border-t border-border-2 px-6 py-4">
              {priceChanged ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs font-medium text-amber-900">
                    Price or Work Hours changed — type <span className="font-mono">publish</span>{" "}
                    to confirm, then save.
                  </p>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => {
                      setConfirmText(e.target.value);
                      if (saveError) setSaveError(null);
                    }}
                    placeholder='Type "publish"'
                    autoComplete="off"
                    className="mt-2 h-10 w-full rounded-xl border border-amber-300 bg-white px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
                  />
                </div>
              ) : null}
              {saveError ? <p className="text-sm text-danger">{saveError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditor}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || (priceChanged && !confirmOk)}
                >
                  {saving ? "Publishing…" : "Save & publish live"}
                </Button>
              </div>
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

type VoiceTreatment = "internal_only" | "platform_absorbed" | "customer_charged";

function VoiceTreatmentSelect({
  value,
  onChange,
}: {
  value: VoiceTreatment;
  onChange: (value: VoiceTreatment) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as VoiceTreatment)}
      className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink"
    >
      <option value="internal_only">Internal only</option>
      <option value="platform_absorbed">Platform absorbed</option>
      <option value="customer_charged">Customer charged</option>
    </select>
  );
}
