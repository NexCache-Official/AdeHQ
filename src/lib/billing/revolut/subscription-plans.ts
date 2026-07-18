import { getRevolutConfig, revolutFetch } from "./client";
import type { BillingCadence } from "@/lib/billing/commerce/types";

export type RevolutSubscriptionPlan = {
  id: string;
  name?: string;
  variations?: Array<{
    id: string;
    phases?: Array<{
      ordinal: number;
      cycle_duration: string;
      cycle_count?: number | null;
      amount?: number;
      currency?: string;
    }>;
  }>;
};

/**
 * Create a Revolut subscription plan with a single infinite monthly/annual phase.
 * amountMinor is in the currency's minor units (cents).
 */
export async function createRevolutSubscriptionPlan(input: {
  name: string;
  providerRef: string;
  currency: string;
  cadence: BillingCadence;
  amountMinor: number;
}): Promise<RevolutSubscriptionPlan> {
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");

  const cycleDuration = input.cadence === "annual" ? "P1Y" : "P1M";

  // Base URL already includes /api — path is /subscription-plans (no version segment).
  return revolutFetch<RevolutSubscriptionPlan>(config, "/subscription-plans", {
    method: "POST",
    headers: { "Idempotency-Key": input.providerRef },
    body: JSON.stringify({
      name: input.name,
      external_reference: input.providerRef,
      variations: [
        {
          phases: [
            {
              ordinal: 1,
              cycle_duration: cycleDuration,
              cycle_count: null,
              amount: input.amountMinor,
              currency: input.currency,
            },
          ],
        },
      ],
    }),
  });
}

export async function retrieveRevolutSubscriptionPlan(
  planId: string,
): Promise<RevolutSubscriptionPlan> {
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");
  return revolutFetch<RevolutSubscriptionPlan>(
    config,
    `/subscription-plans/${encodeURIComponent(planId)}`,
  );
}
