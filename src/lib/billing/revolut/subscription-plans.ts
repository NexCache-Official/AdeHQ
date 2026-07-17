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
      subscription_items?: Array<{
        type?: string;
        amount?: number;
        currency?: string;
      }>;
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

  return revolutFetch<RevolutSubscriptionPlan>(config, "/1.0/subscription-plans", {
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
              subscription_items: [
                {
                  type: "flat",
                  amount: input.amountMinor,
                  currency: input.currency,
                  quantity: 1,
                },
              ],
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
    `/1.0/subscription-plans/${encodeURIComponent(planId)}`,
  );
}
