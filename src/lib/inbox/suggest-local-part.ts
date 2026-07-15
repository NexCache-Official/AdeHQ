/**
 * Turn a workspace display name into a suggested mailbox local-part.
 * Suggestion only — never claims. Falls back to empty when invalid/reserved.
 */

import { validateLocalPart } from "@/lib/inbox/local-part";

export function suggestLocalPartFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  if (!slug) return "";
  const validation = validateLocalPart(slug);
  if (validation.ok) return validation.value;

  // Try padded length if too short (e.g. "HQ" → "hq-mail").
  if (slug.length < 3) {
    const padded = `${slug}-mail`.slice(0, 40);
    const again = validateLocalPart(padded);
    return again.ok ? again.value : "";
  }

  return "";
}
