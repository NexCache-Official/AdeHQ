/**
 * Brain PR-8: assert zero customer-facing Create image/video CTAs.
 * Usage: npx tsx scripts/test-brain-no-customer-media-cta.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "src");
const FORBIDDEN = [
  /Coming soon.*image/i,
  /Create image/i,
  /Generate video/i,
  /Create video/i,
  /image generation.*coming soon/i,
];

const ALLOW_PATH_PARTS = [
  "/admin/brain-media",
  "/lib/brain/catalog/",
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
  }
  if (hits.length) {
    throw new Error(`Customer media CTA leakage:\n${hits.join("\n")}`);
  }
  console.log("PASS  test-brain-no-customer-media-cta");
}

main();
