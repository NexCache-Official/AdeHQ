/** Privacy classification for admin data access. */
export type AdminPrivacyLevel =
  | "public_operational"
  | "internal_metadata"
  | "sensitive_metadata"
  | "restricted_content";

/** Default admin pages may only expose these levels. */
export const DEFAULT_ADMIN_PRIVACY_LEVELS: AdminPrivacyLevel[] = [
  "public_operational",
  "internal_metadata",
];

export function isDefaultAdminPrivacyLevel(level: AdminPrivacyLevel): boolean {
  return DEFAULT_ADMIN_PRIVACY_LEVELS.includes(level);
}

export type RestrictedAccessInput = {
  adminUserId: string;
  reason: string;
  targetType: string;
  targetId: string;
};

const SENSITIVE_KEYS = new Set([
  "body",
  "password",
  "token",
  "secret",
  "authorization",
  "email",
  "phone",
  "recipientEmail",
]);

/** Strip likely PII from tool run payloads shown in admin UI. */
export function redactSensitiveJson(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = redactSensitiveJson(val as Record<string, unknown>);
      continue;
    }
    out[key] = val;
  }
  return out;
}
