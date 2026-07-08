// Generates Gmail-safe PNG assets for the email design system into public/email/.
// Gmail strips inline <svg> and blocks external SVG <img>, so the email header
// logo and every illustration must be a hosted PNG. Source art lives here as
// compact line-art SVG strings; sharp rasterizes them at 2x for retina inboxes.
//
//   node scripts/generate-email-assets.mjs
//
// Re-run whenever the brand mark or an illustration changes.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "email");

const ACCENT = "#2563EB";
const INK = "#0F172A";

/** Minimal 2px line-art on transparent bg, single accent stroke. viewBox 64x64. */
function lineArt(inner, { stroke = ACCENT } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const illustrations = {
  robot: lineArt(
    `<rect x="16" y="22" width="32" height="26" rx="6"/><circle cx="26" cy="34" r="3.2" fill="${ACCENT}" stroke="none"/><circle cx="38" cy="34" r="3.2" fill="${ACCENT}" stroke="none"/><path d="M26 42h12"/><path d="M32 22v-6"/><circle cx="32" cy="12" r="2.5"/><path d="M16 32h-4M52 32h-4"/>`,
  ),
  sparkles: lineArt(
    `<path d="M32 14l4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/><path d="M48 40l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>`,
  ),
  workspace: lineArt(
    `<rect x="12" y="16" width="40" height="28" rx="4"/><path d="M12 24h40"/><circle cx="18" cy="20" r="1.4" fill="${ACCENT}" stroke="none"/><path d="M24 50h16"/><path d="M32 44v6"/>`,
  ),
  shield: lineArt(
    `<path d="M32 12l16 6v12c0 12-8 18-16 22-8-4-16-10-16-22V18z"/><path d="M25 32l5 5 10-11"/>`,
  ),
  lock: lineArt(
    `<rect x="18" y="28" width="28" height="22" rx="4"/><path d="M24 28v-6a8 8 0 0116 0v6"/><circle cx="32" cy="38" r="2.4" fill="${ACCENT}" stroke="none"/><path d="M32 40v4"/>`,
  ),
  envelope: lineArt(
    `<rect x="12" y="18" width="40" height="28" rx="4"/><path d="M12 22l20 14 20-14"/>`,
  ),
  chart: lineArt(
    `<path d="M14 14v36h36"/><path d="M22 40l8-10 7 6 11-16"/><circle cx="22" cy="40" r="2" fill="${ACCENT}" stroke="none"/><circle cx="48" cy="20" r="2" fill="${ACCENT}" stroke="none"/>`,
  ),
  rocket: lineArt(
    `<path d="M32 10c8 6 12 16 12 26l-6 6h-12l-6-6c0-10 4-20 12-26z"/><circle cx="32" cy="26" r="4"/><path d="M26 42l-6 8M38 42l6 8M32 48v6"/>`,
  ),
  celebration: lineArt(
    `<path d="M16 50l10-30 18 18z"/><path d="M40 14c4 0 6 2 6 6M46 26c4 0 6 2 6 6M34 12l2 4M52 20l-4 2"/>`,
  ),
  search: lineArt(
    `<circle cx="28" cy="28" r="14"/><path d="M38 38l12 12"/>`,
  ),
  browser: lineArt(
    `<rect x="12" y="14" width="40" height="34" rx="4"/><path d="M12 24h40"/><circle cx="18" cy="19" r="1.4" fill="${ACCENT}" stroke="none"/><circle cx="24" cy="19" r="1.4" fill="${ACCENT}" stroke="none"/><path d="M20 34h24M20 40h16"/>`,
  ),
  folder: lineArt(
    `<path d="M12 20a4 4 0 014-4h10l5 6h17a4 4 0 014 4v20a4 4 0 01-4 4H16a4 4 0 01-4-4z"/>`,
  ),
  empty: lineArt(
    `<rect x="14" y="18" width="36" height="28" rx="4" stroke-dasharray="4 4"/><path d="M26 32h12" stroke="${INK}"/>`,
    { stroke: "#94A3B8" },
  ),
};

async function renderPng(svg, outName, size) {
  const buf = Buffer.from(svg);
  await sharp(buf, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, outName));
  console.log("  ✓", outName);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // --- Brand marks (from public/brand SVGs) ---
  const iconSvg = await readFile(path.join(root, "public", "brand", "adehq-icon.svg"), "utf8");
  const wordmarkSvg = await readFile(path.join(root, "public", "brand", "adehq-wordmark.svg"), "utf8");

  // Accent-tinted icon (currentColor -> accent) for the email header mark.
  const tintedIcon = iconSvg.replace(/currentColor/g, ACCENT);
  await sharp(Buffer.from(tintedIcon), { density: 384 })
    .resize(120, 120, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, "adehq-icon.png"));
  console.log("  ✓ adehq-icon.png");

  // Wordmark lockup (already colored) — height-bounded for a compact header.
  await sharp(Buffer.from(wordmarkSvg), { density: 384 })
    .resize({ height: 96, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, "adehq-lockup.png"));
  console.log("  ✓ adehq-lockup.png");

  // --- Illustrations ---
  console.log("Illustrations:");
  for (const [name, svg] of Object.entries(illustrations)) {
    await renderPng(svg, `illustration-${name}.png`, 160);
  }

  console.log("\nDone. Assets written to public/email/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
