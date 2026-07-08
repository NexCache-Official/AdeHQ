/**
 * Email test harness.
 *
 *   npx tsx scripts/test-email.ts --render                 # render every template, no send
 *   npx tsx scripts/test-email.ts <template>               # send one template
 *   npx tsx scripts/test-email.ts <template> --to you@x.io # override recipient
 *
 * Sending requires RESEND_API_KEY. Set EMAIL_TEST_MODE=true + EMAIL_TEST_INBOX
 * to reroute everything to a safe inbox (recommended on dev/staging).
 *
 * Uses each template's `PreviewProps` for sample data.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { render } from "@react-email/render";
import { EMAIL_REGISTRY, type TemplateKey } from "@/emails/registry";

function loadEnvLocalIfPresent() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvLocalIfPresent();

function previewProps(key: TemplateKey): Record<string, unknown> {
  const Comp = EMAIL_REGISTRY[key].Component as { PreviewProps?: Record<string, unknown> };
  return Comp.PreviewProps ?? {};
}

async function renderAll() {
  let failed = 0;
  for (const key of Object.keys(EMAIL_REGISTRY) as TemplateKey[]) {
    try {
      const html = await render(createElement(EMAIL_REGISTRY[key].Component as never, previewProps(key) as never));
      const ok = html.includes("<html") && html.length > 200;
      console.log(ok ? "  ✓" : "  ✗", key, `(${html.length} bytes)`);
      if (!ok) failed++;
    } catch (err) {
      failed++;
      console.log("  ✗", key, "-", err instanceof Error ? err.message : err);
    }
  }
  console.log(failed === 0 ? "\nAll templates rendered." : `\n${failed} template(s) failed.`);
  if (failed > 0) process.exit(1);
}

async function sendOne(template: string, to: string) {
  if (!(template in EMAIL_REGISTRY)) {
    console.error(`Unknown template "${template}". Options:\n  ${Object.keys(EMAIL_REGISTRY).join("\n  ")}`);
    process.exit(1);
  }
  const key = template as TemplateKey;
  // Lazy import so --render works without env/network deps.
  const { sendEmail } = await import("@/lib/email/send");
  const result = await sendEmail({ template: key, to, props: previewProps(key) as never });
  console.log(`[${key} -> ${to}]`, JSON.stringify(result, null, 2));
  if (!result.delivered && result.status !== "skipped_unsubscribed") process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--render") || args.length === 0) {
    await renderAll();
    return;
  }
  const template = args[0];
  const toIdx = args.indexOf("--to");
  const to = toIdx >= 0 ? args[toIdx + 1] : process.env.EMAIL_TEST_INBOX;
  if (!to) {
    console.error("Provide a recipient with --to <email> or set EMAIL_TEST_INBOX.");
    process.exit(1);
  }
  await sendOne(template, to);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
