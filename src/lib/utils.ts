import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** Human-friendly relative time, e.g. "3m ago", "2h ago", "just now". */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Returns a deterministic gradient from a hex accent color. */
export function avatarGradient(accent: string): string {
  return `linear-gradient(135deg, ${accent} 0%, ${shade(accent, -28)} 100%)`;
}

/** Lighten (positive) or darken (negative) a hex color by percent. */
export function shade(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const num = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const amt = Math.round(2.55 * percent);
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : plural ?? singular + "s"}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract @Mentions from a message body. Matches names that appear in the candidate list. */
export function extractMentions(
  text: string,
  candidates: { id: string; name: string }[],
): string[] {
  return extractMentionsInOrder(text, candidates).map((m) => m.id);
}

/** Extract @mentions in order of first appearance in text. */
export function extractMentionsInOrder(
  text: string,
  candidates: { id: string; name: string }[],
): { id: string; name: string }[] {
  const lower = text.toLowerCase();
  const hits: { id: string; name: string; index: number }[] = [];

  for (const c of candidates) {
    const escaped = c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`@${escaped}`, "gi");
    const match = re.exec(lower);
    if (match) {
      hits.push({ id: c.id, name: c.name, index: match.index });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const ordered: { id: string; name: string }[] = [];
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    ordered.push({ id: h.id, name: h.name });
  }
  return ordered;
}
