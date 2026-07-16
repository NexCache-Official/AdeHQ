/**
 * Brain PR-8: assert zero customer-facing Create image/video CTAs outside live tools.
 * Usage: npx tsx scripts/test-brain-no-customer-media-cta.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "src");
/**
 * PR-16/17 ship live image + video artifact tools. "Create image/video" is
 * allowed on Brain + integration surfaces. Still forbid stub/coming-soon CTAs.
 */
const FORBIDDEN = [
  /Coming soon.*image/i,
  /Coming soon.*video/i,
  /image generation.*coming soon/i,
  /video generation.*coming soon/i,
];

/** Paths where "Create image/video" / media action copy is intentional. */
const ALLOW_MEDIA_PATHS = [
  "/lib/brain/catalog/",
  "/lib/brain/image/",
  "/lib/brain/video/",
  "/lib/integrations/registry/tool-definitions",
  "/lib/integrations/prompt",
  "/lib/integrations/jobs/image-handlers",
  "/lib/integrations/jobs/video-handlers",
  "/lib/integrations/tool-outcome-artifacts",
  "/lib/integrations/jobs/drain-queued-result",
  "/lib/integrations/reconcile-queued-artifacts",
  "/components/integrations/ToolResultInlineCard",
  "/admin/brain-catalog",
  "/admin/brain-media",
];

const ALLOW_PATH_PARTS = [
  "/admin/brain-media",
  "/lib/brain/catalog/",
  "/lib/brain/image/",
  "/lib/brain/video/",
  "test-brain-no-customer-media-cta",
];

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(path, files);
    } else if (/\.(tsx|ts|jsx|js)$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

function main() {
  const files = walk(ROOT);
  const hits: string[] = [];
  for (const file of files) {
    if (ALLOW_PATH_PARTS.some((p) => file.includes(p))) continue;
    const text = readFileSync(file, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(text)) {
        hits.push(`${file} matches ${re}`);
      }
    }
    // Create image / Create video are live via tools — ban stray customer chrome.
    if (
      /Create image/i.test(text) &&
      !ALLOW_MEDIA_PATHS.some((p) => file.includes(p))
    ) {
      hits.push(`${file} matches /Create image/i outside allowlisted media surfaces`);
    }
    if (
      /Create video/i.test(text) &&
      !ALLOW_MEDIA_PATHS.some((p) => file.includes(p))
    ) {
      hits.push(`${file} matches /Create video/i outside allowlisted media surfaces`);
    }
    if (
      /Generate video/i.test(text) &&
      !ALLOW_MEDIA_PATHS.some((p) => file.includes(p))
    ) {
      hits.push(`${file} matches /Generate video/i outside allowlisted media surfaces`);
    }
  }
  if (hits.length) {
    throw new Error(`Customer media CTA leakage:\n${hits.join("\n")}`);
  }
  console.log("PASS  test-brain-no-customer-media-cta");
}

main();
