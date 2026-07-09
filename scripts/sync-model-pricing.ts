/**
 * V20.1.0a — Sync model pricing from Vercel Gateway + SiliconFlow into ai_model_catalog.
 *
 * Usage:
 *   npm run sync:model-pricing
 *   npm run sync:model-pricing -- --provider=vercel
 *   npm run sync:model-pricing -- --provider=siliconflow
 *   npm run sync:model-pricing -- --dry-run
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { syncModelPricing } from "@/lib/ai/runtime/pricing";

function loadEnvLocalIfPresent() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv: string[]) {
  let provider: "vercel" | "siliconflow" | "all" = "all";
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    if (arg.startsWith("--provider=")) {
      const value = arg.split("=")[1]?.trim().toLowerCase();
      if (value === "vercel" || value === "siliconflow") provider = value;
    }
  }

  return {
    dryRun,
    providers:
      provider === "all"
        ? (["vercel", "siliconflow"] as const)
        : ([provider] as const),
  };
}

async function main() {
  loadEnvLocalIfPresent();
  const { dryRun, providers } = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  let client = null;
  if (url && secretKey) {
    client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else if (!dryRun) {
    console.warn("Supabase secret key missing — running sync without DB writes.");
  }

  console.log(`Model pricing sync (dryRun=${dryRun}, providers=${providers.join(",")})\n`);

  const summary = await syncModelPricing(client, { providers: [...providers], dryRun });

  for (const result of summary.results) {
    const label = result.status.toUpperCase();
    console.log(
      `[${result.provider}] ${label} — added ${result.offersAdded}, updated ${result.offersUpdated}, disabled ${result.offersDisabled}`,
    );
    if (result.error) console.log(`  note: ${result.error}`);
  }

  console.log(
    `\nTotal: added ${summary.totalAdded}, updated ${summary.totalUpdated}, disabled ${summary.totalDisabled}`,
  );

  const failed = summary.results.some((r) => r.status === "failed");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
