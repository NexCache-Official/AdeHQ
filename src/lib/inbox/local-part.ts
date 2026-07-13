/**
 * Canonical local-part validation for mailbox claiming (Slice B).
 */

export const RESERVED_LOCAL_PARTS = new Set([
  "admin",
  "administrator",
  "support",
  "help",
  "security",
  "billing",
  "abuse",
  "postmaster",
  "mailer-daemon",
  "daemon",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "root",
  "hostmaster",
  "webmaster",
  "adehq",
  "team",
  "info",
  "sales",
  "contact",
  "system",
  "notifications",
  "notification",
]);

// Basic abuse blocklist — substrings that must not appear in a claimed address.
const BLOCKED_SUBSTRINGS = ["fuck", "shit", "cunt", "nigger", "faggot", "rape"];

export type LocalPartValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Normalise + validate a requested local-part. Lowercases, enforces charset and
 * length, and rejects reserved / abusive names. Does NOT check availability (a
 * DB unique constraint is the authoritative check for that).
 */
export function validateLocalPart(input: string): LocalPartValidation {
  const value = input.trim().toLowerCase();

  if (value.length < 3) {
    return { ok: false, reason: "Address must be at least 3 characters." };
  }
  if (value.length > 40) {
    return { ok: false, reason: "Address must be 40 characters or fewer." };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return {
      ok: false,
      reason: "Use lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
    };
  }
  if (value.includes("--")) {
    return { ok: false, reason: "Address cannot contain consecutive hyphens." };
  }
  if (RESERVED_LOCAL_PARTS.has(value)) {
    return { ok: false, reason: "That address is reserved. Choose another." };
  }
  if (BLOCKED_SUBSTRINGS.some((bad) => value.includes(bad))) {
    return { ok: false, reason: "That address isn't allowed. Choose another." };
  }

  return { ok: true, value };
}
