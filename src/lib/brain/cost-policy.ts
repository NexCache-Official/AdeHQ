import type { SupabaseClient } from "@supabase/supabase-js";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";

export type CostPolicy = {
  showEstimateAboveWh: number;
  requireUserConfirmAboveWh: number;
  requireManagerApprovalAboveWh: number;
  hardBlockAboveWh: number;
};

export const DEFAULT_COST_POLICY: CostPolicy = {
  showEstimateAboveWh: 2,
  requireUserConfirmAboveWh: 10,
  requireManagerApprovalAboveWh: 25,
  hardBlockAboveWh: 100,
};

export type CostPolicyAction =
  | "none"
  | "info"
  | "user_confirm"
  | "manager_approval"
  | "hard_block";

export function resolveCostPolicyAction(
  estimatedLikelyWh: number,
  policy: CostPolicy = DEFAULT_COST_POLICY,
): CostPolicyAction {
  if (estimatedLikelyWh >= policy.hardBlockAboveWh) return "hard_block";
  if (estimatedLikelyWh >= policy.requireManagerApprovalAboveWh) return "manager_approval";
  if (estimatedLikelyWh >= policy.requireUserConfirmAboveWh) return "user_confirm";
  if (estimatedLikelyWh >= policy.showEstimateAboveWh) return "info";
  return "none";
}

/**
 * Workspace CostPolicy — defaults until settings UI lands.
 * Optional override via workspace metadata key (future) or env JSON ADEHQ_COST_POLICY.
 */
export async function loadWorkspaceCostPolicy(
  _client: SupabaseClient,
  _workspaceId: string,
): Promise<CostPolicy> {
  const raw = process.env.ADEHQ_COST_POLICY?.trim();
  if (!raw) return DEFAULT_COST_POLICY;
  try {
    const parsed = JSON.parse(raw) as Partial<CostPolicy>;
    return {
      showEstimateAboveWh:
        Number(parsed.showEstimateAboveWh) || DEFAULT_COST_POLICY.showEstimateAboveWh,
      requireUserConfirmAboveWh:
        Number(parsed.requireUserConfirmAboveWh) ||
        DEFAULT_COST_POLICY.requireUserConfirmAboveWh,
      requireManagerApprovalAboveWh:
        Number(parsed.requireManagerApprovalAboveWh) ||
        DEFAULT_COST_POLICY.requireManagerApprovalAboveWh,
      hardBlockAboveWh:
        Number(parsed.hardBlockAboveWh) || DEFAULT_COST_POLICY.hardBlockAboveWh,
    };
  } catch {
    return DEFAULT_COST_POLICY;
  }
}

/** Mid-run server enforcement — abort when accumulated USD would exceed maxCostUsd. */
export function wouldExceedMaxCost(input: {
  accumulatedCostUsd: number;
  nextStepEstimatedUsd: number;
  maxCostUsd: number;
}): boolean {
  return input.accumulatedCostUsd + input.nextStepEstimatedUsd > input.maxCostUsd;
}

export function formatWhRange(input: {
  minUsd: number;
  likelyUsd: number;
  maxUsd: number;
  maxAllowedUsd?: number;
}): string {
  const min = workHoursFromCost(input.minUsd);
  const max = workHoursFromCost(input.maxUsd);
  const ceiling =
    input.maxAllowedUsd != null ? workHoursFromCost(input.maxAllowedUsd) : null;
  const base = `Estimated use: ${min}–${max} WH`;
  return ceiling != null ? `${base} · Maximum allowed: ${ceiling} WH` : base;
}

export function evaluatePlanCostPolicy(input: {
  estimatedLikelyCostUsd: number;
  policy?: CostPolicy;
}): { action: CostPolicyAction; estimatedLikelyWh: number; reason?: string } {
  const policy = input.policy ?? DEFAULT_COST_POLICY;
  const estimatedLikelyWh = workHoursFromCost(input.estimatedLikelyCostUsd);
  const action = resolveCostPolicyAction(estimatedLikelyWh, policy);
  if (action === "hard_block") {
    return {
      action,
      estimatedLikelyWh,
      reason: `Estimated ${estimatedLikelyWh} WH exceeds the hard block of ${policy.hardBlockAboveWh} WH.`,
    };
  }
  return { action, estimatedLikelyWh };
}
