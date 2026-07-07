#!/usr/bin/env node
/**
 * Merge live-integration env into .env.local (never prints secret values).
 * Usage: node scripts/activate-live-env.mjs [--push-vercel]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const localPath = resolve(root, ".env.local");
const vercelPullPath = resolve(root, ".env.vercel.pull");
const vercelProductionPath = resolve(root, ".env.vercel.production");
const pushVercel = process.argv.includes("--push-vercel");

function parseEnv(content) {
  const map = new Map();
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    map.set(key, value);
  }
  return map;
}

function serializeEnv(originalContent, map, orderedInserts) {
  const seen = new Set();
  const out = [];

  for (const line of originalContent.split("\n")) {
    if (!line || line.trim().startsWith("#")) {
      out.push(line);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = line.slice(0, eq).trim();
    seen.add(key);
    if (map.has(key)) {
      out.push(`${key}=${map.get(key)}`);
    } else {
      out.push(line);
    }
  }

  const toAppend = [];
  for (const [key, value] of orderedInserts) {
    if (seen.has(key)) continue;
    if (!map.has(key) || !String(map.get(key)).trim()) continue;
    toAppend.push(`${key}=${map.get(key)}`);
    seen.add(key);
  }

  if (toAppend.length > 0) {
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push("# Live integration (V20.0.3 — added by scripts/activate-live-env.mjs)");
    out.push(...toAppend);
  }

  return out.join("\n").replace(/\n+$/, "\n");
}

if (!existsSync(localPath)) {
  console.error("Missing .env.local — copy from .env.example first.");
  process.exit(1);
}

const localMap = parseEnv(readFileSync(localPath, "utf8"));
const original = readFileSync(localPath, "utf8");

if (existsSync(vercelPullPath)) {
  for (const [key, value] of parseEnv(readFileSync(vercelPullPath, "utf8"))) {
    if (!String(localMap.get(key) ?? "").trim() && String(value).trim()) {
      localMap.set(key, value);
    }
  }
}

if (existsSync(vercelProductionPath)) {
  for (const [key, value] of parseEnv(readFileSync(vercelProductionPath, "utf8"))) {
    if (!String(localMap.get(key) ?? "").trim() && String(value).trim()) {
      localMap.set(key, value);
    }
  }
}

if (process.env.BROWSERBASE_API_KEY?.trim() && !localMap.get("BROWSERBASE_API_KEY")?.trim()) {
  localMap.set("BROWSERBASE_API_KEY", process.env.BROWSERBASE_API_KEY.trim());
}

const liveUpdates = {
  AI_RUNTIME_V2_MODE: "on",
  AI_RUNTIME_V2_PROVIDER_PREF: "auto",
  AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION: "false",
  AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION: "false",
  BROWSER_RESEARCH_PROVIDER: "browserbase",
  BROWSER_RESEARCH_LIVE_ENABLED: "true",
  BROWSER_RESEARCH_EVIDENCE_ENABLED: "true",
  BROWSER_RESEARCH_MAX_PAGES: "3",
  BROWSER_RESEARCH_MAX_SECONDS: "120",
  AI_WORK_HOURS_SOFT_WARNINGS_ENABLED: "true",
  AI_WORK_HOURS_WARNING_MIN_LEDGER_ROWS: "10",
  AI_WORK_HOURS_WARNING_MAX_UNMATCHED_RATIO: "0.5",
  AI_WORK_HOURS_WARNING_MAX_MISSING_COST_RATIO: "0.4",
  AI_WORK_HOURS_WARNING_HIGH_HOURS_THRESHOLD: "10",
  AI_WORK_HOURS_SOFT_CAP_SIMULATION_ENABLED: "true",
  AI_WORK_HOURS_PRE_RUN_ESTIMATES_ENABLED: "true",
  AI_WORK_HOURS_DEFAULT_WEEKLY_SOFT_CAP_MINUTES: "600",
  AI_WORK_HOURS_DEFAULT_EMPLOYEE_SOFT_CAP_MINUTES: "240",
};

for (const [key, value] of Object.entries(liveUpdates)) {
  localMap.set(key, value);
}

const vercelKeys = [
  "SUPABASE_SECRET_KEY",
  "AI_GATEWAY_API_KEY",
  "AI_RUNTIME_V2_MODE",
  "AI_RUNTIME_V2_PROVIDER_PREF",
  "AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION",
  "AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION",
  "BROWSER_RESEARCH_PROVIDER",
  "BROWSER_RESEARCH_LIVE_ENABLED",
  "BROWSER_RESEARCH_EVIDENCE_ENABLED",
  "BROWSER_RESEARCH_MAX_PAGES",
  "BROWSER_RESEARCH_MAX_SECONDS",
  "BROWSERBASE_API_KEY",
  "TAVILY_API_KEY",
  "TAVILY_MAX_RESULTS",
  "TAVILY_SEARCH_COST_USD",
  "AI_WORK_HOURS_SHADOW_ENABLED",
  "AI_WORK_HOURS_SOFT_WARNINGS_ENABLED",
  "AI_WORK_HOURS_SOFT_CAP_SIMULATION_ENABLED",
  "AI_WORK_HOURS_PRE_RUN_ESTIMATES_ENABLED",
  "AI_WORK_MINUTE_USD",
];

const orderedInserts = vercelKeys.map((key) => [key, localMap.get(key) ?? ""]);
writeFileSync(localPath, serializeEnv(original, localMap, orderedInserts), "utf8");

console.log("Updated .env.local with live integration flags.");

const checks = [
  ["SUPABASE_SECRET_KEY", "Supabase server writes (sb_secret_…)"],
  ["AI_GATEWAY_API_KEY", "Stagehand LLM fallback (Vercel gateway)"],
  ["BROWSERBASE_API_KEY", "Live browser research"],
  ["TAVILY_API_KEY", "Fast web search fallback"],
];
for (const [key, label] of checks) {
  const val = localMap.get(key)?.trim() ?? "";
  const ok = val.length > 8 && val !== '""' && val !== "''";
  console.log(`  ${ok ? "OK" : "MISSING"}  ${key} — ${label}`);
}

if (!localMap.get("TAVILY_API_KEY")?.trim()) {
  console.log("  INFO  TAVILY_API_KEY unset — factual queries may fall back to mock or Browserbase only");
}

if (pushVercel) {
  console.log("\nPushing env vars to Vercel (Production + Preview)…");
  const targets = ["production", "preview"];
  for (const key of vercelKeys) {
    const value = localMap.get(key)?.trim();
    if (!value) {
      console.log(`  skip  ${key} (empty)`);
      continue;
    }
    for (const target of targets) {
      try {
        execFileSync(
          "npx",
          ["vercel", "env", "add", key, target, "--force", "--yes", "--value", value],
          { stdio: ["ignore", "pipe", "pipe"], cwd: root },
        );
        console.log(`  added ${key} → ${target}`);
      } catch (error) {
        const stderr =
          error && typeof error === "object" && "stderr" in error
            ? String(error.stderr)
            : error instanceof Error
              ? error.message
              : String(error);
        const line = stderr.split("\n").find((l) => l.trim()) ?? stderr.slice(0, 120);
        console.log(`  warn  ${key} → ${target}: ${line}`);
      }
    }
  }
  console.log("Done. Redeploy Vercel for production to pick up new env.");
}
