"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { canViewBilling } from "@/lib/workspace/permissions";
import { PageHeader } from "@/components/Page";
import { Card, Button, Progress } from "@/components/ui";
import { Check, CreditCard, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type PlanCard = {
  planSlug: string;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  weeklyWorkHours: number;
  unlimitedWorkHours: boolean;
};

type BillingSummary = {
  currentPlanSlug: string;
  planDisplayName?: string;
  subscriptionStatus: string | null;
  renewalDate: string | null;
  billingInterval: "monthly" | "annual" | null;
  cancelAtPeriodEnd?: boolean;
  freePlanStartedAt?: string | null;
  currentPlanStartedAt?: string | null;
  capacity: {
    allowance: number | null;
    used: number;
    remaining: number | null;
    unlimited: boolean;
    resetsAt: string;
    warningLevel: string;
  };
  plans: PlanCard[];
  invoices: { id: string; amountCents: number; currency: string; status: string; createdAt: string }[];
  permissions: {
    canStartCheckout: boolean;
    canApplyPromoCode: boolean;
    canChangePlan: boolean;
  };
  commerce?: {
    serviceAccessStatus: string;
    providerStatus: string | null;
    serviceAccessEndsAt: string | null;
    refundPolicy: string;
    legacyManualRenew: boolean;
  };
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(0)}`;
  }
}

export default function SettingsBillingPage() {
  const { state, actions } = useStore();
  const router = useRouter();
  const workspaceId = state.workspace.id;
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role ?? "member";
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("checkout");

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<"monthly" | "annual">(
    searchParams.get("interval") === "annual" ? "annual" : "monthly",
  );
  const [promo, setPromo] = useState("");
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/billing`, {
        headers,
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load billing.");
      setSummary(body as BillingSummary);
      return body as BillingSummary;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (canViewBilling(myRole)) void load();
    else setLoading(false);
  }, [load, myRole]);

  // Sidebar reads workspaces.plan_slug (often already Pro after checkout) while this
  // page historically could keep a stale Free API payload. If they disagree, refetch once.
  const workspacePlanSlug = String(
    state.workspace.planSlug ?? state.workspace.plan ?? "free",
  ).toLowerCase();
  const resyncedRef = useRef(false);
  useEffect(() => {
    if (!summary || !canViewBilling(myRole) || resyncedRef.current) return;
    const apiSlug = String(summary.currentPlanSlug ?? "free").toLowerCase();
    if (apiSlug === "free" && workspacePlanSlug !== "free") {
      resyncedRef.current = true;
      void load();
    }
  }, [summary, workspacePlanSlug, myRole, load]);

  // After Revolut redirect, poll until webhook activates the plan (or timeout).
  // Every exit path re-fetches via load() directly (not just router.replace, which is
  // a shallow client nav and won't by itself refresh already-mounted page state).
  useEffect(() => {
    if (checkoutResult !== "success" || !canViewBilling(myRole)) return;
    let cancelled = false;
    let attempts = 0;
    setConfirmingPayment(true);
    setNotice(null);

    const finish = async (message: string) => {
      setConfirmingPayment(false);
      setNotice(message);
      await actions.refreshWorkspace().catch(() => undefined);
      await load();
      router.replace("/settings/billing");
    };

    const poll = async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/workspaces/${workspaceId}/billing`, {
          headers,
          cache: "no-store",
        });
        const body = (await res.json()) as BillingSummary;
        if (!cancelled && res.ok) {
          setSummary(body);
          if (
            body.subscriptionStatus === "active" ||
            (body.currentPlanSlug && body.currentPlanSlug !== "free")
          ) {
            if (!cancelled) {
              await finish("Payment confirmed. Your plan and weekly AI Work Hours are updated.");
            }
            return;
          }
        }
      } catch {
        /* keep polling */
      }
      attempts += 1;
      if (cancelled) return;
      if (attempts >= 30) {
        // One last direct refetch before giving up — the webhook may have landed
        // just after our last poll attempt.
        await finish(
          "Payment received — plan activation can take a moment. Refresh this page if it has not updated yet.",
        );
        return;
      }
      window.setTimeout(() => {
        void poll();
      }, 2000);
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [actions, checkoutResult, load, myRole, router, workspaceId]);

  // Tier-aware: upgrades start Revolut checkout immediately; downgrades are
  // scheduled for the next renewal (money) / usage boundary (Work Hours) via
  // /billing/change-plan instead of firing a checkout for a lower-price plan.
  const startCheckout = async (planSlug: string) => {
    setBusyPlan(planSlug);
    setNotice(null);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/billing/change-plan`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planSlug, interval, promoCode: promo || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Plan change failed.");
      if (body.checkoutUrl) {
        window.location.href = body.checkoutUrl;
        return;
      }
      if (body.mode === "downgrade_scheduled") {
        setNotice(body.message ?? "Downgrade scheduled at your next renewal.");
        await load();
        return;
      }
      setNotice(body.message ?? "Your upgrade request has been recorded.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan change failed.");
    } finally {
      setBusyPlan(null);
    }
  };

  const cancelSubscription = async () => {
    if (
      !window.confirm(
        "Cancel auto-renewal? You keep access until the end of the current paid period. Payments are non-refundable except where required by law.",
      )
    ) {
      return;
    }
    setBusyPlan("cancel");
    setNotice(null);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/billing/cancel`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: "Customer cancelled from Settings → Billing" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Cancel failed.");
      setNotice(body.message ?? "Subscription cancelled at period end.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed.");
    } finally {
      setBusyPlan(null);
    }
  };

  if (!canViewBilling(myRole)) {
    return (
      <>
        <PageHeader title="Billing" icon={<CreditCard className="h-5 w-5" />} />
        <Card className="p-6 text-sm text-ink-3">Only workspace admins can view billing.</Card>
      </>
    );
  }

  const PLAN_TIER: Record<string, number> = {
    free: 0,
    pro: 1,
    team: 2,
    business: 3,
    enterprise: 4,
  };
  const apiPlanSlug = String(summary?.currentPlanSlug ?? "free").toLowerCase();
  // Prefer the higher tier between API resolve and the live workspace row so a
  // briefly stale billing payload cannot flash Free after Pro checkout.
  const effectivePlanSlug =
    (PLAN_TIER[apiPlanSlug] ?? 0) >= (PLAN_TIER[workspacePlanSlug] ?? 0)
      ? apiPlanSlug
      : workspacePlanSlug;
  const cap = summary?.capacity;
  const pct =
    cap && !cap.unlimited && cap.allowance ? Math.min(100, (cap.used / cap.allowance) * 100) : 0;
  const isFree = effectivePlanSlug === "free";
  const currentPlanDisplayName =
    !isFree && apiPlanSlug === "free"
      ? effectivePlanSlug.charAt(0).toUpperCase() + effectivePlanSlug.slice(1)
      : (summary?.planDisplayName ?? effectivePlanSlug);

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Plan, Work Hours, and payment history for this workspace."
        icon={<CreditCard className="h-5 w-5" />}
      />

      {confirmingPayment && (
        <Card className="mb-4 border-accent/30 bg-accent/[0.06] p-4 text-sm text-ink-2">
          Confirming payment with Revolut…
        </Card>
      )}
      {checkoutResult === "cancelled" && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-700">
          Checkout was not completed. Your plan was not changed — you can try again below.
        </Card>
      )}
      {notice && !confirmingPayment && (
        <Card className="mb-4 border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-sm text-emerald-800">
          {notice}
        </Card>
      )}
      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <Card className="p-6 text-sm text-ink-3">Loading…</Card>
      ) : summary ? (
        <div className="space-y-6">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border-2 bg-gradient-to-br from-accent/[0.06] to-transparent px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                    Current plan
                  </p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
                    {currentPlanDisplayName}
                  </p>
                  <p className="mt-1 text-sm text-ink-3">
                    {summary.subscriptionStatus
                      ? `Status: ${summary.subscriptionStatus}`
                      : isFree
                        ? "Free plan"
                        : "Subscription"}
                    {summary.billingInterval ? ` · billed ${summary.billingInterval}` : ""}
                    {summary.cancelAtPeriodEnd ||
                    summary.commerce?.serviceAccessStatus === "scheduled_to_end"
                      ? " · cancels at period end"
                      : ""}
                    {summary.commerce?.serviceAccessStatus
                      ? ` · access: ${summary.commerce.serviceAccessStatus}`
                      : ""}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-surface/80 px-4 py-3 text-right backdrop-blur">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                    AI Work Hours
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                    {cap?.unlimited
                      ? "Unlimited"
                      : `${Math.max(0, cap?.remaining ?? 0).toFixed(1)} left`}
                  </p>
                  <p className="text-sm text-ink-3">Resets {formatDate(cap?.resetsAt ?? null)}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 px-6 py-4 text-sm sm:grid-cols-3">
              {isFree ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                    Free since
                  </p>
                  <p className="mt-0.5 text-ink-2">{formatDate(summary.freePlanStartedAt ?? null)}</p>
                </div>
              ) : (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                    Member since
                  </p>
                  <p className="mt-0.5 text-ink-2">{formatDate(summary.freePlanStartedAt ?? null)}</p>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Current term started
                </p>
                <p className="mt-0.5 text-ink-2">{formatDate(summary.currentPlanStartedAt ?? null)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  {summary.cancelAtPeriodEnd ||
                  summary.commerce?.serviceAccessStatus === "scheduled_to_end"
                    ? "Access until"
                    : "Renews"}
                </p>
                <p className="mt-0.5 text-ink-2">
                  {formatDate(
                    summary.commerce?.serviceAccessEndsAt ?? summary.renewalDate,
                  )}
                </p>
              </div>
            </div>
            {!isFree &&
            summary.permissions.canChangePlan &&
            summary.commerce?.serviceAccessStatus !== "scheduled_to_end" &&
            !summary.cancelAtPeriodEnd ? (
              <div className="border-t border-border-2 px-6 py-4">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyPlan === "cancel"}
                  onClick={() => void cancelSubscription()}
                >
                  {busyPlan === "cancel" ? "Cancelling…" : "Cancel subscription"}
                </Button>
                <p className="mt-2 text-xs text-ink-3">
                  {summary.commerce?.refundPolicy ??
                    "Payments are non-refundable except where required by applicable law."}
                </p>
              </div>
            ) : null}
            {cap && !cap.unlimited && (
              <div className="border-t border-border-2 px-6 py-4">
                <Progress value={pct} />
                <p className="mt-1 text-xs text-ink-3">
                  {cap.used.toFixed(1)} of {cap.allowance?.toFixed(0)} Work Hours used this period
                  {(cap.remaining ?? 0) < 0
                    ? ` · ${Math.abs(cap.remaining ?? 0).toFixed(1)} over plan`
                    : ""}
                </p>
              </div>
            )}
          </Card>

          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Plans</h2>
              <div className="inline-flex rounded-lg border border-border-2 p-0.5">
                {(["monthly", "annual"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setInterval(opt)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                      interval === opt ? "bg-accent-soft text-accent-d" : "text-ink-3",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {summary.plans.map((plan) => {
                const isCurrent = plan.planSlug === effectivePlanSlug;
                const priceCents =
                  interval === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents;
                const isEnterprise = plan.planSlug === "enterprise";
                const isDowngrade =
                  (PLAN_TIER[plan.planSlug] ?? 0) < (PLAN_TIER[effectivePlanSlug] ?? 0);
                return (
                  <Card
                    key={plan.planSlug}
                    className={cn(
                      "flex flex-col p-5 transition-shadow",
                      isCurrent && "ring-2 ring-accent/40 shadow-lift",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-ink">{plan.displayName}</h3>
                      {isCurrent && (
                        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-d">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                      {isEnterprise ? "Custom" : formatMoney(priceCents)}
                      {!isEnterprise && (
                        <span className="text-sm font-normal text-ink-3">
                          /{interval === "annual" ? "yr" : "mo"}
                        </span>
                      )}
                    </p>
                    <ul className="mt-3 flex-1 space-y-1.5 text-sm text-ink-2">
                      <li className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-accent" />{" "}
                        {plan.unlimitedWorkHours ? "Custom" : `${plan.weeklyWorkHours}`} AI Work
                        Hours/wk
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-accent" /> Unlimited humans
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-accent" /> Unlimited AI employees
                      </li>
                    </ul>
                    {summary.permissions.canStartCheckout && !isCurrent && !isEnterprise && (
                      <Button
                        className="mt-4 w-full"
                        size="sm"
                        onClick={() => startCheckout(plan.planSlug)}
                        disabled={busyPlan === plan.planSlug}
                      >
                        {busyPlan === plan.planSlug
                          ? "Starting…"
                          : isDowngrade
                            ? "Schedule downgrade"
                            : "Upgrade"}
                      </Button>
                    )}
                    {isEnterprise && (
                      <Button className="mt-4 w-full" size="sm" variant="outline" disabled>
                        Contact sales
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>

          {summary.permissions.canApplyPromoCode && (
            <Card className="p-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <Sparkles className="h-4 w-4 text-accent" /> Promo code
              </h2>
              <p className="mb-3 text-sm text-ink-3">
                Have a promo code? Enter it before upgrading and it will be applied at checkout.
              </p>
              <input
                className="input-field max-w-xs uppercase"
                placeholder="LAUNCH50"
                value={promo}
                onChange={(e) => setPromo(e.target.value.toUpperCase())}
              />
            </Card>
          )}

          <Card className="p-6">
            <h2 className="mb-3 text-sm font-semibold text-ink">Payment history</h2>
            {summary.invoices.length === 0 ? (
              <p className="text-sm text-ink-3">No invoices yet.</p>
            ) : (
              <div className="space-y-2">
                {summary.invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-xl border border-border-2 px-3 py-2.5 text-sm"
                  >
                    <span className="text-ink-2">{formatDate(inv.createdAt)}</span>
                    <span className="tabular-nums font-medium text-ink">
                      {formatMoney(inv.amountCents, inv.currency)}
                    </span>
                    <span className="capitalize text-ink-3">{inv.status}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
