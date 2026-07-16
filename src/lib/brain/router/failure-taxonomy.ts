export type BrainFailureReason =
  | "provider_unavailable"
  | "timeout"
  | "invalid_schema"
  | "tool_failure"
  | "policy_rejection"
  | "cost_ceiling"
  | "low_confidence"
  | "user_cancelled";

export type FailureFallback =
  | "backup_route"
  | "retry_once_then_backup"
  | "repair_prompt_retry"
  | "retry_or_degrade"
  | "stop_approval"
  | "stop_ask_user"
  | "escalate_if_budget"
  | "abort_partial_wh";

export const FAILURE_FALLBACK: Record<BrainFailureReason, FailureFallback> = {
  provider_unavailable: "backup_route",
  timeout: "retry_once_then_backup",
  invalid_schema: "repair_prompt_retry",
  tool_failure: "retry_or_degrade",
  policy_rejection: "stop_approval",
  cost_ceiling: "stop_ask_user",
  low_confidence: "escalate_if_budget",
  user_cancelled: "abort_partial_wh",
};

export function isEscalationFailure(reason: BrainFailureReason): boolean {
  return reason === "low_confidence" || reason === "provider_unavailable";
}
