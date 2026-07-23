import type { ProcedureHandler } from "../../contracts";

export type FinancialInputs = {
  revenue?: number;
  cogs?: number;
  operatingExpenses?: number;
  netIncome?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  equity?: number;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return Number(v);
  }
  return null;
}

function ratio(n: number | null, d: number | null): number | null {
  if (n == null || d == null || d === 0) return null;
  return Number((n / d).toFixed(6));
}

export function calculateFinancialRatios(input: FinancialInputs) {
  const revenue = num(input.revenue);
  const cogs = num(input.cogs);
  const opex = num(input.operatingExpenses);
  const netIncome = num(input.netIncome);
  const currentAssets = num(input.currentAssets);
  const currentLiabilities = num(input.currentLiabilities);
  const totalAssets = num(input.totalAssets);
  const totalLiabilities = num(input.totalLiabilities);
  const equity = num(input.equity);

  const grossProfit =
    revenue != null && cogs != null ? Number((revenue - cogs).toFixed(6)) : null;
  const operatingIncome =
    grossProfit != null && opex != null ? Number((grossProfit - opex).toFixed(6)) : null;

  return {
    grossMargin: ratio(grossProfit, revenue),
    operatingMargin: ratio(operatingIncome, revenue),
    netMargin: ratio(netIncome, revenue),
    currentRatio: ratio(currentAssets, currentLiabilities),
    debtToEquity: ratio(totalLiabilities, equity),
    returnOnAssets: ratio(netIncome, totalAssets),
    returnOnEquity: ratio(netIncome, equity),
  };
}

export const calculate_financial_ratios: ProcedureHandler = (input) => {
  const ratios = calculateFinancialRatios(input as FinancialInputs);
  return { ok: true, output: { ratios } };
};
