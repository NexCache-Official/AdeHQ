"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  subscriptionStatus: string | null;
  renewalDate: string | null;
  billingInterval: "monthly" | "annual" | null;
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
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function SettingsBillingPage() {
  const { state } = useStore();
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/billing`, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load billing.");
      setSummary(body as BillingSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (canViewBilling(myRole)) void load();
    else setLoading(false);
  }, [load, myRole]);

  const startCheckout = async (planSlug: string) => {
    setBusyPlan(planSlug);
    setNotice(null);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/billing/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planSlug, interval, promoCode: promo || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Checkout failed.");
      if (body.checkoutUrl) {
        window.location.href = body.checkoutUrl;
        return;
      }
      setNotice(body.message ?? "Your upgrade request has been recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
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

  const cap = summary?.capacity;
  const pct = cap && !cap.unlimited && cap.allowance ? Math.min(100, (cap.used / cap.allowance) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Manage your plan, AI Work Hours, and payment details."
        icon={<CreditCard className="h-5 w-5" />}
      />

      {checkoutResult === "success" && (
        <Card className="mb-4 border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-sm text-emerald-700">
          Payment successful. Your plan and weekly AI Work Hours have been updated.
        </Card>
      )}
      {checkoutResult === "cancelled" && (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-700">
          Checkout was not completed. Your plan was not changed — you can try again below.
        </Card>
      )}
      {notice && <Card className="mb-4 p-4 text-sm text-ink-2">{notice}</Card>}
      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <Card className="p-6 text-sm text-ink-3">Loading…</Card>
      ) : summary ? (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Current plan</p>
                <p className="mt-1 text-2xl font-semibold capitalize text-ink">{summary.currentPlanSlug}</p>
                <p className="mt-0.5 text-sm text-ink-3">
                  {summary.subscriptionStatus ? `Status: ${summary.subscriptionStatus}` : "No active subscription"}
                  {summary.billingInterval ? ` · ${summary.billingInterval}` : ""}
                </p>
                {summary.renewalDate && (
                  <p className="text-sm text-ink-3">Renews {formatDate(summary.renewalDate)}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">AI Work Hours</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                  {cap?.unlimited ? "Unlimited" : `${(cap?.remaining ?? 0).toFixed(1)} left`}
                </p>
                <p className="text-sm text-ink-3">Resets {formatDate(cap?.resetsAt ?? null)}</p>
              </div>
            </div>
            {cap && !cap.unlimited && (
              <div className="mt-4">
                <Progress value={pct} />
                <p className="mt-1 text-xs text-ink-3">
                  {cap.used.toFixed(1)} of {cap.allowance?.toFixed(0)} used
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
                const isCurrent = plan.planSlug === summary.currentPlanSlug;
                const priceCents = interval === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents;
                const isEnterprise = plan.planSlug === "enterprise";
                return (
                  <Card key={plan.planSlug} className={cn("p-5", isCurrent && "ring-2 ring-accent/40")}>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-ink">{plan.displayName}</h3>
                      {isCurrent && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-d">Current</span>}
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                      {isEnterprise ? "Custom" : `$${(priceCents / 100).toFixed(0)}`}
                      {!isEnterprise && <span className="text-sm font-normal text-ink-3">/{interval === "annual" ? "yr" : "mo"}</span>}
                    </p>
                    <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
                      <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-accent" /> {plan.unlimitedWorkHours ? "Custom" : `${plan.weeklyWorkHours}`} AI Work Hours/wk</li>
                      <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-accent" /> Unlimited humans</li>
                      <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-accent" /> Unlimited AI employees</li>
                    </ul>
                    {summary.permissions.canStartCheckout && !isCurrent && !isEnterprise && (
                      <Button
                        className="mt-4 w-full"
                        size="sm"
                        onClick={() => startCheckout(plan.planSlug)}
                        disabled={busyPlan === plan.planSlug}
                      >
                        {busyPlan === plan.planSlug ? "Starting…" : "Upgrade"}
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
                  <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border-2 px-3 py-2 text-sm">
                    <span className="text-ink-2">{formatDate(inv.createdAt)}</span>
                    <span className="tabular-nums text-ink">
                      {inv.currency} {(inv.amountCents / 100).toFixed(2)}
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
