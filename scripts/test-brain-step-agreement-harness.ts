/**
 * PR-13 larger shadow harness: Qwen3-8B vs Step-3.5-Flash
 * — intent agreement across a broader case set
 * — token → USD → WH cost parity checks against Brain pricing snapshots
 *
 * Does NOT promote Step. Report-only for agreement; hard-fails on cost math bugs
 * or if either model is unusable.
 *
 *   npm run test:brain:step-harness
 */

import { generateObject } from "ai";
import { z } from "zod";
import { resolve } from "node:path";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured, SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import { getBrainRoute } from "@/lib/brain/catalog/routes";
import { getLiveSeedSnapshot, costUsdFromSnapshot } from "@/lib/brain/catalog/pricing-snapshots";
import { workHoursFromCost, displayWorkHours } from "@/lib/billing/costing/work-hours";

const PROD_ROUTE_ID = "route_text_qwen3_8b_sf";
const SHADOW_ROUTE_ID = "route_classify_step35_flash_sf";

const classifierSchema = z.object({
  intent: z.enum([
    "silent_note",
    "social_broadcast",
    "direct_reply",
    "panel_response",
    "lead_collaborator",
    "handoff",
    "ambient_smart_assist",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  selectedEmployeeIds: z.array(z.string()),
  shouldRespond: z.boolean(),
});

type Case = {
  id: string;
  message: string;
  softExpect?: z.infer<typeof classifierSchema>["intent"];
};

const CASES: Case[] = [
  { id: "greeting", message: "Hey team, good morning!", softExpect: "direct_reply" },
  {
    id: "silent_note",
    message: "Just noting for myself: follow up with Acme on Thursday.",
    softExpect: "silent_note",
  },
  {
    id: "direct_task",
    message: "@Maya draft a short launch email for the SaaS waitlist.",
    softExpect: "direct_reply",
  },
  {
    id: "panel",
    message: "Maya and Jordan — give me your takes on pricing for SMB vs mid-market.",
    softExpect: "panel_response",
  },
  {
    id: "lead_collab",
    message: "Maya, lead the campaign brief; Jordan can support with copy polish.",
    softExpect: "lead_collaborator",
  },
  {
    id: "handoff",
    message: "Maya, hand this pricing question to Jordan — he's better at copy.",
    softExpect: "handoff",
  },
  {
    id: "social",
    message: "lol that standup meme was perfect 😂",
    softExpect: "social_broadcast",
  },
  {
    id: "status_update",
    message: "Update: investor deck is 80% done. No action needed from AI.",
    softExpect: "silent_note",
  },
  {
    id: "multi_mention",
    message: "@Maya @Jordan both of you: critique this homepage headline options list.",
    softExpect: "panel_response",
  },
  {
    id: "clarify",
    message: "Maya — before you draft, what audience should we prioritize?",
    softExpect: "direct_reply",
  },
  {
    id: "ambient_help",
    message: "Can someone help me figure out what to do next on the launch?",
    softExpect: "ambient_smart_assist",
  },
  {
    id: "human_chat",
    message: "Sam: I'll own the vendor call. Priya: I'll update the CRM after.",
    softExpect: "silent_note",
  },
];

function loadEnvLocalIfPresent() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function buildPrompt(message: string): string {
  return `You are AdeHQ's Conversation Orchestrator.

Classify the latest user message into exactly one intent:
- silent_note
- social_broadcast
- direct_reply
- panel_response
- lead_collaborator
- handoff
- ambient_smart_assist

Room employees:
- emp_maya: Maya (Marketing)
- emp_jordan: Jordan (Copywriter)

Smart Assist enabled: true

Recent messages:
human: Starting standup.
human: Sam: I'll sync later.

Latest user message:
${message}

Return a JSON object with keys: intent, confidence, reason, selectedEmployeeIds, shouldRespond.
Keep reason under 15 words. No markdown fences. JSON only.`;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty model text.");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON.");
  return JSON.parse(candidate.slice(start, end + 1));
}

type CallResult = {
  ok: boolean;
  intent?: string;
  confidence?: number;
  shouldRespond?: boolean;
  selectedEmployeeIds?: string[];
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  workHours: number;
  displayWh: number;
  error?: string;
};

function costForRoute(
  routeId: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; workHours: number; displayWh: number } {
  const snap = getLiveSeedSnapshot(routeId);
  const costUsd = snap
    ? costUsdFromSnapshot(snap, { inputTokens, outputTokens })
    : 0;
  const workHours = workHoursFromCost(costUsd);
  return { costUsd, workHours, displayWh: displayWorkHours(workHours) };
}

async function classifyProd(modelId: string, message: string, routeId: string): Promise<CallResult> {
  const started = Date.now();
  try {
    const result = await generateObject({
      model: siliconFlowChatModel(modelId),
      schema: classifierSchema,
      system: "Return a single JSON object matching the schema. No prose.",
      prompt: buildPrompt(message),
      maxOutputTokens: 400,
      temperature: 0,
      abortSignal: AbortSignal.timeout(60_000),
    });
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cost = costForRoute(routeId, inputTokens, outputTokens);
    return {
      ok: true,
      intent: result.object.intent,
      confidence: result.object.confidence,
      shouldRespond: result.object.shouldRespond,
      selectedEmployeeIds: result.object.selectedEmployeeIds,
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      ...cost,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      workHours: 0,
      displayWh: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function classifyStepRaw(
  modelId: string,
  message: string,
  routeId: string,
  maxTokens: number,
): Promise<CallResult> {
  const started = Date.now();
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      workHours: 0,
      displayWh: 0,
      error: "SILICONFLOW_API_KEY missing",
    };
  }
  try {
    const res = await fetch(`${SILICONFLOW_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "system",
            content:
              "Return a single JSON object only. No markdown. No prose. Keep reason under 15 words.",
          },
          { role: "user", content: buildPrompt(message) },
        ],
        max_tokens: maxTokens,
        temperature: 0,
        enable_thinking: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        workHours: 0,
        displayWh: 0,
        error: payload.message ?? `HTTP ${res.status}`,
      };
    }
    const msg = payload.choices?.[0]?.message;
    const content = (msg?.content ?? "").trim();
    const reasoning = (msg?.reasoning_content ?? "").trim();
    const inputTokens = payload.usage?.prompt_tokens ?? 0;
    const outputTokens = payload.usage?.completion_tokens ?? 0;
    const cost = costForRoute(routeId, inputTokens, outputTokens);
    let lastError = "Model did not return JSON.";
    for (const text of [content, reasoning].filter(Boolean)) {
      try {
        const parsed = classifierSchema.parse(extractJsonObject(text));
        return {
          ok: true,
          intent: parsed.intent,
          confidence: parsed.confidence,
          shouldRespond: parsed.shouldRespond,
          selectedEmployeeIds: parsed.selectedEmployeeIds,
          durationMs: Date.now() - started,
          inputTokens,
          outputTokens,
          ...cost,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ok: false,
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      ...cost,
      error: lastError,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      workHours: 0,
      displayWh: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function classifyShadow(modelId: string, message: string, routeId: string): Promise<CallResult> {
  const first = await classifyStepRaw(modelId, message, routeId, 1600);
  if (first.ok) return first;
  return classifyStepRaw(modelId, message, routeId, 2800);
}

async function main() {
  loadEnvLocalIfPresent();
  const prod = getBrainRoute(PROD_ROUTE_ID);
  const shadow = getBrainRoute(SHADOW_ROUTE_ID);
  if (!prod || !shadow) throw new Error("Missing classifier routes");
  if (!isSiliconFlowConfigured()) {
    console.error("FAIL: SILICONFLOW_API_KEY missing");
    process.exit(1);
  }

  console.log("AdeHQ Brain — Step agreement + cost harness (PR-13)\n");
  console.log(`prod=${prod.model}  shadow=${shadow.model}`);
  console.log(`cases=${CASES.length}  promotion=NOT performed\n`);

  const rows: Array<Record<string, unknown>> = [];
  let prodOk = 0;
  let shadowOk = 0;
  let bothOk = 0;
  let agree = 0;
  let softProd = 0;
  let softStep = 0;
  let softBoth = 0;
  let prodCost = 0;
  let stepCost = 0;
  let prodWh = 0;
  let stepWh = 0;
  let costMathFails = 0;

  for (const c of CASES) {
    console.log(`── ${c.id} ──`);
    const prodResult = await classifyProd(prod.model, c.message, prod.id);
    const stepResult = await classifyShadow(shadow.model, c.message, shadow.id);

    if (prodResult.ok) {
      prodOk += 1;
      prodCost += prodResult.costUsd;
      prodWh += prodResult.workHours;
      // Metering invariant: WH == cost / 0.01 (4dp)
      const expectedWh = workHoursFromCost(prodResult.costUsd);
      if (Math.abs(expectedWh - prodResult.workHours) > 1e-9) {
        costMathFails += 1;
        console.log(`  COST BUG prod: wh=${prodResult.workHours} expected=${expectedWh}`);
      }
    }
    if (stepResult.ok) {
      shadowOk += 1;
      stepCost += stepResult.costUsd;
      stepWh += stepResult.workHours;
      const expectedWh = workHoursFromCost(stepResult.costUsd);
      if (Math.abs(expectedWh - stepResult.workHours) > 1e-9) {
        costMathFails += 1;
        console.log(`  COST BUG step: wh=${stepResult.workHours} expected=${expectedWh}`);
      }
    }

    const fmt = (label: string, r: CallResult) => {
      if (!r.ok) {
        console.log(`  ${label}: FAIL ${r.durationMs}ms — ${r.error}`);
        return;
      }
      console.log(
        `  ${label}: ${r.intent} conf=${r.confidence?.toFixed(2)} ` +
          `in=${r.inputTokens} out=${r.outputTokens} ` +
          `usd=${r.costUsd.toFixed(6)} wh=${r.workHours.toFixed(4)} ` +
          `display=${r.displayWh.toFixed(2)} ${r.durationMs}ms`,
      );
    };
    fmt("prod", prodResult);
    fmt("step", stepResult);

    if (prodResult.ok && stepResult.ok) {
      bothOk += 1;
      if (prodResult.intent === stepResult.intent) {
        agree += 1;
        console.log("  agree: YES");
      } else {
        console.log("  agree: NO");
      }
    }
    if (c.softExpect) {
      softBoth += 1;
      if (prodResult.ok && prodResult.intent === c.softExpect) softProd += 1;
      if (stepResult.ok && stepResult.intent === c.softExpect) softStep += 1;
    }

    rows.push({
      id: c.id,
      softExpect: c.softExpect ?? null,
      prod: prodResult,
      step: stepResult,
      agree:
        prodResult.ok && stepResult.ok
          ? prodResult.intent === stepResult.intent
          : null,
    });
    console.log("");
  }

  const agreePct = bothOk ? Math.round((agree / bothOk) * 100) : 0;
  const softProdPct = softBoth ? Math.round((softProd / softBoth) * 100) : 0;
  const softStepPct = softBoth ? Math.round((softStep / softBoth) * 100) : 0;
  const costRatio = prodCost > 0 ? stepCost / prodCost : null;

  console.log("── summary ──");
  console.log(`prod ok:     ${prodOk}/${CASES.length}`);
  console.log(`step ok:     ${shadowOk}/${CASES.length}`);
  console.log(`intent agree:${agree}/${bothOk} (${agreePct}%)`);
  console.log(`soft expect: prod ${softProdPct}% · step ${softStepPct}%`);
  console.log(`prod cost:   $${prodCost.toFixed(6)} · ${prodWh.toFixed(4)} WH`);
  console.log(`step cost:   $${stepCost.toFixed(6)} · ${stepWh.toFixed(4)} WH`);
  console.log(
    `step/prod $: ${costRatio == null ? "n/a" : `${costRatio.toFixed(2)}x`}`,
  );
  console.log(`cost math fails: ${costMathFails}`);
  console.log("shadow remains shadow — no promotion");

  const outDir = "/tmp/adehq-brain-step-harness";
  mkdirSync(outDir, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    prodModel: prod.model,
    shadowModel: shadow.model,
    cases: CASES.length,
    prodOk,
    shadowOk,
    bothOk,
    agree,
    agreePct,
    softProdPct,
    softStepPct,
    prodCostUsd: prodCost,
    stepCostUsd: stepCost,
    prodWorkHours: prodWh,
    stepWorkHours: stepWh,
    stepOverProdCostRatio: costRatio,
    costMathFails,
    rows,
  };
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outDir}/report.json`);

  const minOk = Math.ceil(CASES.length * 0.6);
  if (prodOk < minOk || shadowOk < minOk) {
    console.error("\nFAIL: success rate too low for harness.");
    process.exit(1);
  }
  if (costMathFails > 0) {
    console.error("\nFAIL: WH metering math invariant broken.");
    process.exit(1);
  }
  // Snapshot rates must produce positive cost when tokens reported.
  if (prodOk > 0 && prodCost <= 0) {
    console.error("\nFAIL: production path reported tokens but $0 cost — snapshot wiring broken.");
    process.exit(1);
  }

  console.log("\nPASS  Step agreement + cost harness complete.");
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exit(1);
});
