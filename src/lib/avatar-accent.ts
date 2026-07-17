/**
 * Deterministic avatar accents so same initials still look distinct.
 * Returns background, foreground, and a ring style derived from id hash.
 */

const PALETTE = [
  { bg: "#2F6FED", fg: "#FFFFFF", ring: "#93C5FD" },
  { bg: "#0F766E", fg: "#FFFFFF", ring: "#5EEAD4" },
  { bg: "#B45309", fg: "#FFFFFF", ring: "#FCD34D" },
  { bg: "#BE123C", fg: "#FFFFFF", ring: "#FDA4AF" },
  { bg: "#6D28D9", fg: "#FFFFFF", ring: "#C4B5FD" },
  { bg: "#0369A1", fg: "#FFFFFF", ring: "#7DD3FC" },
  { bg: "#15803D", fg: "#FFFFFF", ring: "#86EFAC" },
  { bg: "#9A3412", fg: "#FFFFFF", ring: "#FDBA74" },
  { bg: "#334155", fg: "#FFFFFF", ring: "#94A3B8" },
  { bg: "#A21CAF", fg: "#FFFFFF", ring: "#F0ABFC" },
  { bg: "#0E7490", fg: "#FFFFFF", ring: "#67E8F9" },
  { bg: "#4C1D95", fg: "#FFFFFF", ring: "#A78BFA" },
] as const;

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarAccentForId(id: string): {
  background: string;
  foreground: string;
  ring: string;
  /** 0–3 pattern index for optional shape accent */
  pattern: number;
} {
  const h = hashId(id || "unknown");
  const swatch = PALETTE[h % PALETTE.length];
  return {
    background: swatch.bg,
    foreground: swatch.fg,
    ring: swatch.ring,
    pattern: (h >>> 8) % 4,
  };
}
