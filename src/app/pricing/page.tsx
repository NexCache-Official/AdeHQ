"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

type PublicPlan = {
  planSlug: string;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  weeklyWorkHours: number;
  unlimitedWorkHours: boolean;
  entitlements: {
    intelligence_tier: string | null;
    web_search: string | null;
    browser_research: string | null;
    support_tier: string | null;
  };
};

function titleize(value: string | null): string {
  if (!value) return "—";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch("/api/public/plans")
      .then((res) => res.json())
      .then((body) => setPlans(body.plans ?? []))
      .catch(() => setPlans([]));
    void supabase.auth.getSession().then(({ data }) => setLoggedIn(Boolean(data.session)));
  }, []);

  const choosePlan = (planSlug: string) => {
    const query = `plan=${planSlug}&interval=${interval}`;
    // Logged-in users route to workspace billing (role-based checkout gating happens there);
    // logged-out users route to signup carrying the selected plan.
    if (loggedIn) router.push(`/settings/billing?${query}`);
    else router.push(`/signup?${query}`);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Simple, usage-based pricing</h1>
        <p className="mx-auto mt-3 max-w-2xl text-ink-2">
          Unlimited humans. Unlimited AI employees. You only pay for active AI work, measured in AI
          Work Hours.
        </p>
        <div className="mt-6 inline-flex rounded-lg border border-border-2 p-0.5">
          {(["monthly", "annual"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setInterval(opt)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                interval === opt ? "bg-accent-soft text-accent-d" : "text-ink-3",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {plans.map((plan) => {
          const isEnterprise = plan.planSlug === "enterprise";
          const isFree = plan.planSlug === "free";
          const priceCents = interval === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents;
          return (
            <Card key={plan.planSlug} className="flex flex-col p-5">
              <h3 className="text-lg font-semibold text-ink">{plan.displayName}</h3>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                {isEnterprise ? "Custom" : isFree ? "$0" : `$${(priceCents / 100).toFixed(0)}`}
                {!isEnterprise && !isFree && (
                  <span className="text-sm font-normal text-ink-3">/{interval === "annual" ? "yr" : "mo"}</span>
                )}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-2">
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                  {plan.unlimitedWorkHours ? "Custom" : `${plan.weeklyWorkHours}`} AI Work Hours/wk
                </li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-accent" /> Unlimited human members</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-accent" /> Unlimited AI employees</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-accent" /> {titleize(plan.entitlements.intelligence_tier)} intelligence</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-accent" /> {titleize(plan.entitlements.support_tier)} support</li>
              </ul>
              <Button
                className="mt-5 w-full"
                variant={isFree ? "outline" : "primary"}
                onClick={() => (isEnterprise ? undefined : choosePlan(plan.planSlug))}
                disabled={isEnterprise}
              >
                {isEnterprise ? "Contact sales" : isFree ? "Start free" : `Choose ${plan.displayName}`}
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="mt-10 text-center text-sm text-ink-3">
        AI Work Hours measure AI workload across chat, search, browsing, files, and reports. Simple
        messages use very little; advanced work like browser research and long-context analysis uses
        more.{" "}
        <Link href="/login" className="text-accent-d underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
