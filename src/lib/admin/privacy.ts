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
