import { avatarAccentForId } from "@/lib/avatar-accent";
import { initials, shade } from "@/lib/utils";

/** SVG default avatar — unique gradient + initials per user id. */
export function renderDefaultAvatarSvg(userId: string, name: string, size = 256): string {
  const accent = avatarAccentForId(userId);
  const letters = initials(name || "User");
  const from = accent.background;
  const to = shade(from, -28);
  const fontSize = Math.round(size * 0.36);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="url(#g)"/>
  <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
    font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    font-size="${fontSize}" font-weight="700" fill="${accent.foreground}">${escapeXml(letters)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function publicAvatarUrl(supabaseUrl: string, path: string, cacheBust?: string | number): string {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/storage/v1/object/public/adehq-avatars/${path}`;
  if (cacheBust == null) return url;
  return `${url}?v=${encodeURIComponent(String(cacheBust))}`;
}
