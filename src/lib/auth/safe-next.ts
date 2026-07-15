/** Same-origin relative path for post-auth redirects (`?next=`). */
export function safeAuthNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  const next = raw.trim();
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return fallback;
}
