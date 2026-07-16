/**
 * PR-13 shadow eval: production classifier (Qwen3-8B) vs Step-3.5-Flash.
 *
 * Live SiliconFlow calls only — does NOT promote Step into production scoring.
 * Step on SF rejects JSON mode and defaults to thinking; this script uses
 * plain chat/completions with enable_thinking=false + text JSON parse.
 *
 *   npm run test:brain:step-shadow
 */

import { generateObject } from "ai";
import { z } from "zod";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured, SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import { getBrainRoute } from "@/lib/brain/catalog/routes";

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
};

const CASES: Case[] = [
  { id: "greeting", message: "Hey team, good morning!" },
  {
    id: "silent_note",
    message: "Just noting for myself: follow up with Acme on Thursday.",
  },
  {
    id: "direct_task",
    message: "@Maya draft a short launch email for the SaaS waitlist.",
  },
  {
    id: "panel",
    message: "Maya and Jordan — give me your takes on pricing for SMB vs mid-market.",
  },
  {
    id: "lead_collab",
    message: "Maya, lead the campaign brief; Jordan can support with copy polish.",
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

Smart Assist enabled: false

Recent messages:
human: Starting standup.

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
  inputTokens?: number;
  outputTokens?: number;
  mode: "json_mode" | "text_parse";
  error?: string;
};

async function classifyProd(modelId: string, message: string): Promise<CallResult> {
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
    return {
      ok: true,
      intent: result.object.intent,
      confidence: result.object.confidence,
      shouldRespond: result.object.shouldRespond,
      selectedEmployeeIds: result.object.selectedEmployeeIds,
      durationMs: Date.now() - started,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      mode: "json_mode",
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      mode: "json_mode",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function classifyStepRaw(
  modelId: string,
  message: string,
  maxTokens: number,
): Promise<CallResult> {
  const started = Date.now();
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      durationMs: 0,
      mode: "text_parse",
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
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        mode: "text_parse",
        error: payload.message ?? `HTTP ${res.status}`,
      };
    }

    const msg = payload.choices?.[0]?.message;
    const content = (msg?.content ?? "").trim();
    const reasoning = (msg?.reasoning_content ?? "").trim();
    const candidates = [content, reasoning].filter(Boolean);
    let lastError = "Model did not return JSON.";
    for (const text of candidates) {
      try {
        const parsed = classifierSchema.parse(extractJsonObject(text));
        return {
          ok: true,
          intent: parsed.intent,
          confidence: parsed.confidence,
          shouldRespond: parsed.shouldRespond,
          selectedEmployeeIds: parsed.selectedEmployeeIds,
          durationMs: Date.now() - started,
          inputTokens: payload.usage?.prompt_tokens,
          outputTokens: payload.usage?.completion_tokens,
          mode: "text_parse",
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ok: false,
      durationMs: Date.now() - started,
      mode: "text_parse",
      error: `${lastError} (contentLen=${content.length}, reasoningLen=${reasoning.length}, finish=${payload.choices?.[0]?.finish_reason ?? "?"})`,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      mode: "text_parse",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function classifyShadow(modelId: string, message: string): Promise<CallResult> {
  const first = await classifyStepRaw(modelId, message, 1600);
  if (first.ok) return first;
  // Retry once with a larger budget when truncation ate the JSON.
  const retry = await classifyStepRaw(modelId, message, 2800);
  if (retry.ok) return { ...retry, error: undefined };
  return {
    ...retry,
    error: `${first.error ?? "fail"}; retry: ${retry.error ?? "fail"}`,
  };
}

async function main() {
  loadEnvLocalIfPresent();

  const prod = getBrainRoute(PROD_ROUTE_ID);
  const shadow = getBrainRoute(SHADOW_ROUTE_ID);
  if (!prod || prod.environment !== "production") {
    throw new Error(`Missing production classifier route ${PROD_ROUTE_ID}`);
  }
  if (!shadow || shadow.environment !== "shadow") {
    throw new Error(`Missing shadow classifier route ${SHADOW_ROUTE_ID}`);
  }

  console.log("AdeHQ Brain — Step-3.5-Flash classifier shadow (PR-13)\n");
  console.log(`Production: ${prod.model} (${prod.id}) [json_mode]`);
  console.log(`Shadow:     ${shadow.model} (${shadow.id}) [raw text_parse, enable_thinking=false]`);
  console.log("Promotion:  NOT performed — report only\n");

  if (!isSiliconFlowConfigured()) {
    console.error("FAIL: SILICONFLOW_API_KEY is not set (load .env.local).");
    process.exit(1);
  }

  let bothOk = 0;
  let intentAgree = 0;
  let prodOk = 0;
  let shadowOk = 0;

  for (const c of CASES) {
    console.log(`── ${c.id} ──`);
    console.log(`msg: ${c.message}`);

    // Sequential to avoid SF burst limits on the heavier Step path.
    const prodResult = await classifyProd(prod.model, c.message);
    const shadowResult = await classifyShadow(shadow.model, c.message);

    if (prodResult.ok) prodOk += 1;
    if (shadowResult.ok) shadowOk += 1;

    const line = (label: string, r: CallResult) => {
      if (!r.ok) {
        console.log(`  ${label}: FAIL ${r.durationMs}ms (${r.mode}) — ${r.error}`);
        return;
      }
      console.log(
        `  ${label}: ${r.intent} conf=${r.confidence?.toFixed(2)} respond=${r.shouldRespond} ` +
          `ids=[${(r.selectedEmployeeIds ?? []).join(",")}] ` +
          `${r.durationMs}ms in=${r.inputTokens ?? "?"} out=${r.outputTokens ?? "?"}`,
      );
    };
    line("prod ", prodResult);
    line("step ", shadowResult);

    if (prodResult.ok && shadowResult.ok) {
      bothOk += 1;
      if (prodResult.intent === shadowResult.intent) {
        intentAgree += 1;
        console.log("  agree: YES");
      } else {
        console.log("  agree: NO");
      }
    }
    console.log("");
  }

  const agreePct = bothOk === 0 ? 0 : Math.round((intentAgree / bothOk) * 100);
  console.log("── summary ──");
  console.log(`prod ok:    ${prodOk}/${CASES.length}`);
  console.log(`step ok:    ${shadowOk}/${CASES.length}`);
  console.log(`both ok:    ${bothOk}/${CASES.length}`);
  console.log(`intent agree (when both ok): ${intentAgree}/${bothOk} (${agreePct}%)`);
  console.log("shadow route remains environment=shadow — no promotion");
  console.log("note: Step SF has no json_mode; thinking disabled via enable_thinking=false");

  // Shadow gate: majority usable classifications. Disagreement is informational.
  const minOk = Math.ceil(CASES.length * 0.6);
  if (prodOk < minOk) {
    console.error(`\nFAIL: production Qwen3-8B success ${prodOk}/${CASES.length} below ${minOk}.`);
    process.exit(1);
  }
  if (shadowOk < minOk) {
    console.error(`\nFAIL: Step-3.5-Flash success ${shadowOk}/${CASES.length} below ${minOk}.`);
    process.exit(1);
  }

  console.log("\nPASS  Step classifier shadow probe complete.");
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exit(1);
});
