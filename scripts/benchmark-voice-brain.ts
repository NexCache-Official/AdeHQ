/**
 * PR-18.2A9 — Voice Brain route benchmark.
 *
 * Measures injected-text → first useful content token (not total completion).
 * Compares SiliconFlow cheap/default routes and optional xAI chat when keyed.
 *
 * Usage:
 *   npm run benchmark:voice-brain
 *   ADEHQ_VOICE_BRAIN_BENCH_RUNS=20 npm run benchmark:voice-brain
 */

import { SILICONFLOW_CHEAP_MODEL, DEFAULT_SILICONFLOW_MODEL } from "../src/lib/config/features";
import { streamSiliconFlowText } from "../src/lib/ai/siliconflow-call";
import { compileVoiceFastPrompt, type VoiceSessionSnapshot } from "../src/lib/brain/voice/voice-session-snapshot";

type BenchCase =
  | "no_context"
  | "static_prefix"
  | "lean_session"
  | "lean_plus_tools"
  | "structured_output_note";

type ProviderId = "siliconflow_cheap" | "siliconflow_default" | "xai_chat";

type RunResult = {
  provider: ProviderId;
  model: string;
  benchCase: BenchCase;
  warm: boolean;
  prepMs: number;
  ttftMs: number | null;
  error?: string;
};

const RUNS = Math.max(1, Number(process.env.ADEHQ_VOICE_BRAIN_BENCH_RUNS ?? 8));
const USER_MESSAGE =
  process.env.ADEHQ_VOICE_BRAIN_BENCH_PROMPT ??
  "Should we prioritize retention or acquisition this quarter?";

function sampleSnapshot(withTools: boolean): VoiceSessionSnapshot {
  return {
    callId: "bench_call",
    workspaceId: "bench_ws",
    roomId: "bench_room",
    topicId: "bench_topic",
    humanUserId: "bench_user",
    employeeId: "bench_emp",
    employeeName: "Priya Carter",
    employeeRole: "Account Executive",
    employeePrompt: [
      "You are Priya Carter, an AI employee inside AdeHQ.",
      "Begin with the conclusion. No markdown. No tools.",
    ].join("\n"),
    employeeVoiceProfile: {
      voiceEnabled: true,
      voiceIdentityKey: "employee-bench",
      locale: "en",
      pace: 1,
      tone: "warm",
      routePreference: "auto",
      genderMode: "auto",
      resolvedGender: "female",
      providerBindings: [],
      premiumVoiceAllowed: false,
    },
    conversationSummary: "Discussing GTM priorities for Q3.",
    recentTurns: [
      {
        speaker: "human",
        text: "We're debating retention vs acquisition.",
        at: new Date().toISOString(),
      },
      {
        speaker: "employee",
        text: "Retention usually compounds better at your stage.",
        at: new Date().toISOString(),
      },
    ],
    activeEntities: ["retention", "acquisition"],
    relevantMemoryDigest: "Company stage: Series A B2B SaaS.",
    permissionsDigest: "Fast path cannot mutate CRM/Drive/email.",
    availableToolNames: withTools
      ? ["web_search", "crm.createDeal", "artifact.createDocx", "tasks.createTask"]
      : [],
    promptCacheKey: "voice:bench:v1",
    version: 1,
    builtAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };
}

function buildPrompt(benchCase: BenchCase): { system: string; prompt: string } {
  if (benchCase === "no_context") {
    return {
      system: "Reply in one short spoken sentence.",
      prompt: USER_MESSAGE,
    };
  }
  if (benchCase === "static_prefix") {
    return {
      system: sampleSnapshot(false).employeePrompt,
      prompt: USER_MESSAGE,
    };
  }
  if (benchCase === "lean_plus_tools") {
    return compileVoiceFastPrompt({
      snapshot: sampleSnapshot(true),
      userMessage: USER_MESSAGE,
    });
  }
  if (benchCase === "structured_output_note") {
    const lean = compileVoiceFastPrompt({
      snapshot: sampleSnapshot(false),
      userMessage: USER_MESSAGE,
    });
    return {
      system: `${lean.system}\nAlso prepare JSON effects.toolCalls in mind but do not emit them.`,
      prompt: lean.prompt,
    };
  }
  return compileVoiceFastPrompt({
    snapshot: sampleSnapshot(false),
    userMessage: USER_MESSAGE,
  });
}

async function runSiliconFlow(input: {
  provider: ProviderId;
  model: string;
  benchCase: BenchCase;
  warm: boolean;
}): Promise<RunResult> {
  const prepStarted = Date.now();
  const compiled = buildPrompt(input.benchCase);
  const prepMs = Date.now() - prepStarted;
  const requestStarted = Date.now();
  let firstTokenAt: number | null = null;
  try {
    await streamSiliconFlowText(
      compiled.system,
      compiled.prompt,
      input.model,
      120,
      12_000,
      0.35,
      (delta) => {
        if (!firstTokenAt && delta.trim()) firstTokenAt = Date.now();
      },
    );
    return {
      provider: input.provider,
      model: input.model,
      benchCase: input.benchCase,
      warm: input.warm,
      prepMs,
      ttftMs: firstTokenAt != null ? firstTokenAt - requestStarted : null,
    };
  } catch (error) {
    return {
      provider: input.provider,
      model: input.model,
      benchCase: input.benchCase,
      warm: input.warm,
      prepMs,
      ttftMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runXaiChat(input: {
  benchCase: BenchCase;
  warm: boolean;
}): Promise<RunResult> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  const model = process.env.ADEHQ_VOICE_FAST_XAI_MODEL?.trim() || "grok-2-latest";
  const prepStarted = Date.now();
  const compiled = buildPrompt(input.benchCase);
  const prepMs = Date.now() - prepStarted;
  if (!apiKey) {
    return {
      provider: "xai_chat",
      model,
      benchCase: input.benchCase,
      warm: input.warm,
      prepMs,
      ttftMs: null,
      error: "XAI_API_KEY not configured",
    };
  }
  const requestStarted = Date.now();
  let firstTokenAt: number | null = null;
  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.35,
        max_tokens: 120,
        messages: [
          { role: "system", content: compiled.system },
          { role: "user", content: compiled.prompt },
        ],
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(`xAI chat failed (${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (!firstTokenAt && delta.trim()) firstTokenAt = Date.now();
        } catch {
          // ignore malformed SSE chunks
        }
      }
      if (firstTokenAt) break;
    }
    await reader.cancel().catch(() => undefined);
    return {
      provider: "xai_chat",
      model,
      benchCase: input.benchCase,
      warm: input.warm,
      prepMs,
      ttftMs: firstTokenAt != null ? firstTokenAt - requestStarted : null,
    };
  } catch (error) {
    return {
      provider: "xai_chat",
      model,
      benchCase: input.benchCase,
      warm: input.warm,
      prepMs,
      ttftMs: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

async function main() {
  const cases: BenchCase[] = [
    "no_context",
    "static_prefix",
    "lean_session",
    "lean_plus_tools",
    "structured_output_note",
  ];
  const results: RunResult[] = [];

  if (!process.env.SILICONFLOW_API_KEY?.trim()) {
    console.error("SILICONFLOW_API_KEY is required for benchmark:voice-brain");
    process.exit(1);
  }

  for (const benchCase of cases) {
    for (let run = 0; run < RUNS; run += 1) {
      const warm = run > 0;
      results.push(
        await runSiliconFlow({
          provider: "siliconflow_cheap",
          model: SILICONFLOW_CHEAP_MODEL,
          benchCase,
          warm,
        }),
      );
      results.push(
        await runSiliconFlow({
          provider: "siliconflow_default",
          model: DEFAULT_SILICONFLOW_MODEL,
          benchCase,
          warm,
        }),
      );
      results.push(await runXaiChat({ benchCase, warm }));
    }
  }

  const groups = new Map<string, RunResult[]>();
  for (const result of results) {
    const key = `${result.provider}|${result.benchCase}|${result.warm ? "warm" : "cold"}`;
    const list = groups.get(key) ?? [];
    list.push(result);
    groups.set(key, list);
  }

  console.log("\nVoice Brain TTFT benchmark (ms to first content token)\n");
  console.log(
    [
      "provider".padEnd(22),
      "case".padEnd(22),
      "temp".padEnd(6),
      "n".padStart(3),
      "p50".padStart(7),
      "p95".padStart(7),
      "prep_p50".padStart(9),
      "errors".padStart(7),
    ].join(" "),
  );

  const summary: Array<{
    key: string;
    p50: number | null;
    provider: string;
    benchCase: string;
  }> = [];

  for (const [key, list] of groups) {
    const [provider, benchCase, temp] = key.split("|");
    const ttfts = list
      .map((item) => item.ttftMs)
      .filter((value): value is number => typeof value === "number");
    const preps = list.map((item) => item.prepMs);
    const errors = list.filter((item) => item.error).length;
    const p50 = percentile(ttfts, 50);
    const p95 = percentile(ttfts, 95);
    summary.push({ key, p50, provider: provider!, benchCase: benchCase! });
    console.log(
      [
        (provider ?? "").padEnd(22),
        (benchCase ?? "").padEnd(22),
        (temp ?? "").padEnd(6),
        String(list.length).padStart(3),
        String(p50 ?? "-").padStart(7),
        String(p95 ?? "-").padStart(7),
        String(percentile(preps, 50) ?? "-").padStart(9),
        String(errors).padStart(7),
      ].join(" "),
    );
  }

  const leanWarm = summary
    .filter((item) => item.benchCase === "lean_session" && item.key.endsWith("|warm"))
    .filter((item) => item.p50 != null)
    .sort((a, b) => (a.p50 ?? 1e9) - (b.p50 ?? 1e9));
  console.log("\nRecommended voice_fast provider by lean_session warm p50:");
  if (leanWarm[0]) {
    console.log(
      `  ${leanWarm[0].provider} @ ${leanWarm[0].p50} ms (target: <600 ms p50)`,
    );
  } else {
    console.log("  No successful lean_session warm runs.");
  }
}

void main();
