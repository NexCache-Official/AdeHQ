#!/usr/bin/env node
/**
 * V19.8.2 — AI Runtime Preflight Audit
 * Read-only scan of the repo. Does not modify runtime behavior.
 *
 * Usage: node scripts/audit-ai-callers.mjs
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function rg(pattern, glob = "**/*.{ts,tsx}") {
  try {
    const cmd = `rg -n --no-heading --glob '${glob}' '${pattern.replace(/'/g, "'\\''")}' '${SRC}'`;
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function section(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function printMatches(label, lines, max = 40) {
  console.log(`\n${label} (${lines.length} matches)`);
  if (lines.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const line of lines.slice(0, max)) {
    console.log(`  ${line}`);
  }
  if (lines.length > max) {
    console.log(`  ... and ${lines.length - max} more`);
  }
}

function verifyPath(relativePath) {
  const full = join(ROOT, relativePath);
  return existsSync(full) ? "OK" : "MISSING";
}

section("AdeHQ AI Runtime Preflight Audit (V19.8.2)");

console.log(`Root: ${ROOT}`);
console.log(`Date: ${new Date().toISOString()}`);

section("Path verification (critical migration targets)");
const paths = [
  "src/lib/topic-summary/generate.ts",
  "src/lib/orchestration/llm-classifier.ts",
  "src/app/api/hiring/recruiter/route.ts",
  "src/app/api/hiring/candidates/route.ts",
  "src/lib/server/file-embeddings.ts",
  "src/lib/server/process-employee-response.ts",
  "src/lib/ai/model-router.ts",
  "src/lib/ai/siliconflow-client.ts",
  "src/lib/ai/siliconflow-call.ts",
  "src/lib/supabase/ai-runtime.ts",
  "docs/audits/archive/ai-runtime-migration-checklist.md",
];
for (const p of paths) {
  console.log(`  [${verifyPath(p)}] ${p}`);
}

section("Direct SiliconFlow / LLM patterns");
printMatches("siliconFlowChatModel / getSiliconFlowClient", rg("siliconFlowChatModel|getSiliconFlowClient"));
printMatches("callSiliconFlowEmployee", rg("callSiliconFlowEmployee"));
printMatches("generateObject / generateText (ai SDK)", rg("generateObject|generateText"));
printMatches("SILICONFLOW_API / embeddings fetch", rg("SILICONFLOW_API|/embeddings"));
printMatches("routeEmployeeResponse", rg("routeEmployeeResponse"));
printMatches("beginAiRun / finalizeAiRun", rg("beginAiRun|finalizeAiRun"));
printMatches("reserveUsage / finalizeUsage", rg("reserveUsage|finalizeUsage"));
printMatches("recordAiRuntime (in-memory only)", rg("recordAiRuntime"));

section("UI model/provider surfaces");
printMatches("displayEngineModel / resolvedModelId", rg("displayEngineModel|resolvedModelId"));
printMatches("employee.model / provider in TSX", rg("employee\\.(model|provider|modelMode)", "**/*.tsx"));

section("Migration order reminder");
console.log(`
  V19.9.0a  Runtime types + flags + SiliconFlowAdapter (no caller migration)
  V19.9.0b  Additive DB + work units
  V19.9.0c  topic-summary → classifier → hiring → embeddings
  V19.9.0d  Employee hot path (process-employee-response, model-router)
  V19.9.0e  VercelGatewayAdapter

  Feature flags (V19.9.0a):
    AI_RUNTIME_V2_MODE=off|shadow|on
    AI_RUNTIME_V2_PROVIDER_PREF=auto|siliconflow|vercel|mock

  Full checklist: docs/audits/archive/ai-runtime-migration-checklist.md
`);

section("Done");
console.log("This script is read-only. Re-run after codebase changes.\n");
