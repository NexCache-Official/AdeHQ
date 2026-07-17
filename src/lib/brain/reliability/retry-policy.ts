import type { FailureClass, RetryDecision } from "./types";

/**
 * Deterministic retry taxonomy for Brain steps.
 * Users are not charged for AdeHQ-internal defects.
 */
export function decideRetry(failureClass: FailureClass, attemptCount: number): RetryDecision {
  switch (failureClass) {
    case "transient_provider":
      if (attemptCount < 1) return { action: "retry", delayMs: 400 };
      return { action: "fallback" };
    case "malformed_output":
      if (attemptCount < 1) return { action: "repair_once" };
      return { action: "fallback" };
    case "permission":
    case "user_input":
    case "cancelled":
    case "budget":
      return { action: "fail", chargeUser: false };
    case "insufficient_evidence":
      return { action: "fallback" };
    case "internal_application":
      return { action: "fail", chargeUser: false };
    default:
      return { action: "fail", chargeUser: false };
  }
}
