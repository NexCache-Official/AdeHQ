import type { BillingCadence } from "./types";

/** Annual equivalent monthly minor units (floor). $199/yr → 1658 cents. */
export function annualEquivalentMonthlyMinor(annualAmountMinor: number): number {
  return Math.floor(annualAmountMinor / 12);
}

/** Savings percent vs paying monthly for 12 months. */
export function annualSavingsPercent(
  monthlyAmountMinor: number,
  annualAmountMinor: number,
): number {
  const twelve = monthlyAmountMinor * 12;
  if (twelve <= 0) return 0;
  return Math.round(((twelve - annualAmountMinor) / twelve) * 1000) / 10;
}

export function formatUsdFromMinor(amountMinor: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountMinor / 100);
}

export type PricingCardDisplay = {
  cadence: BillingCadence;
  headline: string;
  subline: string;
  savingsPercent: number | null;
};

/**
 * Monthly/Annual toggle display — never stack ambiguous dual prices.
 */
export function pricingCardDisplay(opts: {
  cadence: BillingCadence;
  monthlyAmountMinor: number;
  annualAmountMinor: number;
}): PricingCardDisplay {
  if (opts.cadence === "monthly") {
    return {
      cadence: "monthly",
      headline: `${formatUsdFromMinor(opts.monthlyAmountMinor)}/month`,
      subline: "Billed monthly",
      savingsPercent: null,
    };
  }
  const equiv = annualEquivalentMonthlyMinor(opts.annualAmountMinor);
  const savings = annualSavingsPercent(opts.monthlyAmountMinor, opts.annualAmountMinor);
  return {
    cadence: "annual",
    headline: `${formatUsdFromMinor(opts.annualAmountMinor)}/year`,
    subline: `Equivalent to ${formatUsdFromMinor(equiv)}/month`,
    savingsPercent: savings,
  };
}
