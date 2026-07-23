export type RetryDecision = "retry" | "never";

const RETRYABLE = new Set([
  "timeout",
  "rate_limited",
  "provider_unavailable",
  "lease_expired",
  "transient_network",
  "busy",
  "conflict_retry",
  "ECONNRESET",
  "ETIMEDOUT",
  "503",
  "429",
]);

const NEVER = new Set([
  "validation_failed",
  "schema_invalid",
  "permission_denied",
  "not_found",
  "cancelled",
  "hard_wh_cap",
  "unsafe_formula",
  "procedure_untrusted",
  "procedure_not_registered",
  "invalid_definition",
  "cycle_detected",
  "policy_blocked",
  "400",
  "401",
  "403",
  "404",
  "422",
]);

/**
 * Classify whether a playbook/procedure step error may be retried.
 * Conservative: unknown codes → never.
 */
export function classifyRetry(errorCode: string | null | undefined): RetryDecision {
  if (!errorCode?.trim()) return "never";
  const code = errorCode.trim();
  const lower = code.toLowerCase();

  if (NEVER.has(code) || NEVER.has(lower)) return "never";
  if (RETRYABLE.has(code) || RETRYABLE.has(lower)) return "retry";

  if (lower.includes("timeout") || lower.includes("rate_limit") || lower.includes("unavailable")) {
    return "retry";
  }
  if (
    lower.includes("validation") ||
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("invalid")
  ) {
    return "never";
  }

  return "never";
}
