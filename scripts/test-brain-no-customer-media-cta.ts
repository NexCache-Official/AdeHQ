/**
 * Brain PR-8: assert zero customer-facing Create image/video CTAs.
 * Usage: npx tsx scripts/test-brain-no-customer-media-cta.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "src");
/**
 * PR-16 ships live image artifact tools. "Create image" is allowed in Brain
 * image + integration surfaces. Still forbid stub/coming-soon CTAs and video.
 */
const FORBIDDEN = [
  /Coming soon.*image/i,
  /Generate video/i,
  /Create video/i,
  /image generation.*coming soon/i,
];

/** Paths where "Create image" / media action copy is intentional. */
const ALLOW_CREATE_IMAGE_PATHS = [
  "/lib/brain/catalog/",
  "/lib/brain/image/",
  "/lib/integrations/registry/tool-definitions",
  "/lib/integrations/prompt",
  "/lib/integrations/jobs/image-handlers",
  "/admin/brain-catalog",
  "/admin/brain-media",
];

const ALLOW_PATH_PARTS = [
  "/admin/brain-media",
  "/lib/brain/catalog/",
  "/lib/brain/image/",
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
    // Create image is live via tools — ban stray customer chrome outside allowlist.
    if (
      /Create image/i.test(text) &&
      !ALLOW_CREATE_IMAGE_PATHS.some((p) => file.includes(p))
    ) {
      hits.push(`${file} matches /Create image/i outside allowlisted image surfaces`);
    }
  }
  if (hits.length) {
    throw new Error(`Customer media CTA leakage:\n${hits.join("\n")}`);
  }
  console.log("PASS  test-brain-no-customer-media-cta");
}

main();
