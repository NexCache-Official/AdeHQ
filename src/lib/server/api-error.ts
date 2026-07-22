/**
 * Sanitizes internal/technical error messages before they reach a client
 * response. Route handlers regularly do
 * `error instanceof Error ? error.message : "..."` in their catch block —
 * useful for deliberately friendly, user-facing messages (validation errors,
 * policy reasons, "insufficient balance", etc.) but dangerous for anything
 * that leaked up from an infra failure, because those messages routinely
 * mention internal implementation details (table/column names, migration
 * filenames, raw provider error bodies) that should stay in server logs /
 * the Debug trace, not the chat UI.
 *
 * This is intentionally a narrow, pattern-based filter rather than a full
 * error taxonomy — call sites that already throw deliberately friendly
 * errors are unaffected; only messages that look like internal/infra leakage
 * get swapped for `fallback`. The original error should still be
 * `console.error`'d by the caller for the Debug trace / server logs.
 */
const INTERNAL_LEAK_PATTERNS: RegExp[] = [
  /\bmigration\b/i,
  /\btable is not available\b/i,
  /\brelation .* does not exist\b/i,
  /\bcolumn .* does not exist\b/i,
  /\bviolates .* constraint\b/i,
  /\bpermission denied for\b/i,
  /\brow-level security\b/i,
  /\bsupabase(?:key| secret| service role)\b/i,
  /\becconnrefused\b/i,
  /\bfetch failed\b/i,
  /\bschema validation\b/i,
  /\bunexpected token\b/i,
  /\bat Object\.<anonymous>\b/,
  /\bTypeError:|\bReferenceError:|\bRangeError:/,
  // Raw upstream provider failures (STT/TTS/model calls) — these carry a
  // numeric HTTP status + a slice of the provider's own error body, which is
  // useful in server logs but not actionable or friendly for an end user.
  /\b(?:STT|TTS) failed \(\d+\)/i,
  /\bmime type\b.*\bnot supported\b/i,
];

export function looksLikeInternalErrorMessage(message: string): boolean {
  return INTERNAL_LEAK_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Returns a client-safe message for an unexpected/500-class error: the
 * original message when it looks like a deliberately friendly, user-facing
 * string, otherwise a generic fallback. Always call `console.error` on the
 * real error separately — this function only decides what the *client*
 * sees.
 */
export function safeApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (looksLikeInternalErrorMessage(error.message)) return fallback;
  return error.message;
}
