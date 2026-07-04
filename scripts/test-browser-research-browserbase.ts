/**
 * V20.0.2 — Browserbase live browser research provider tests.
 *
 * Usage: npm run test:browser-research:browserbase
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { estimateCost } from "@/lib/ai/model-catalog";
import {
  BROWSER_RESEARCH_FORBIDDEN_COPY,
  BROWSER_RESEARCH_UI_COPY,
  getBrowserResearchProviderConfig,
  isBrowserResearchEvidenceEnabled,
  isBrowserResearchLiveEnabled,
  isBrowserResearchLiveReady,
  isBrowserbaseConfigured,
  resolveBrowserResearchProvider,
  runMockBrowserResearchProvider,
} from "@/lib/ai/browser-research";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { captureBrowserResearchPageEvidenceSafely } from "@/lib/ai/browser-research/evidence-capture";
import { createResearchReportArtifactFromRun } from "@/lib/ai/browser-research/report-artifact";
import {
  closeBrowserbaseSessionForRun,
  runBrowserbaseBrowserResearchProvider,
  setBrowserbaseProviderTestHooks,
} from "@/lib/ai/browser-research/browserbase-provider";
import {
  getBrowserResearchLiveSession,
  registerBrowserResearchLiveSession,
  terminateBrowserResearchLiveSession,
} from "@/lib/ai/browser-research/session-registry";
import {
  listStagehandLlmCandidates,
  resolveSiliconFlowStagehandPrimaryModel,
} from "@/lib/ai/browser-research/stagehand-llm-config";
import { resolveSiliconFlowRuntimeModel } from "@/lib/ai/runtime/adapters/siliconflow";
import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

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

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}`);
    console.log(`      ${detail}`);
    throw error;
  }
}

async function main() {
  loadEnvLocalIfPresent();
  console.log("AdeHQ Browser Research Browserbase — V20.0.3\n");

  let passed = 0;
  let skipped = 0;

  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  const skip = (name: string, reason: string) => {
    console.log(`SKIP  ${name}`);
    console.log(`      ${reason}`);
    skipped += 1;
  };

  await run("default provider pref remains mock", async () => {
    await withEnv(
      {
        BROWSER_RESEARCH_PROVIDER: undefined,
        BROWSER_RESEARCH_LIVE_ENABLED: undefined,
        BROWSERBASE_API_KEY: undefined,
      },
      () => {
        assert(getBrowserResearchProviderConfig().providerPref === "mock", "expected mock pref");
      },
    );
  });

  await run("browserbase pref without live gates falls back to tavily/mock", async () => {
    await withEnv(
      {
        BROWSER_RESEARCH_PROVIDER: "browserbase",
        BROWSER_RESEARCH_LIVE_ENABLED: "false",
        AI_RUNTIME_V2_MODE: "on",
        BROWSERBASE_API_KEY: "test-key",
        TAVILY_API_KEY: "test-tavily",
      },
      () => {
        const resolved = resolveBrowserResearchProvider();
        assert(resolved.provider === "tavily", "expected tavily fallback");
        assert(Boolean(resolved.fallbackReason), "expected fallback reason");
        assert(!isBrowserResearchLiveReady(), "live should not be ready");
      },
    );
  });

  await run("live ready requires runtime on + provider + live flag + API key", async () => {
    await withEnv(
      {
        BROWSER_RESEARCH_PROVIDER: "browserbase",
        BROWSER_RESEARCH_LIVE_ENABLED: "true",
        AI_RUNTIME_V2_MODE: "on",
        BROWSERBASE_API_KEY: "test-key",
      },
      () => {
        assert(isBrowserResearchLiveEnabled(), "live flag on");
        assert(isBrowserbaseConfigured(), "browserbase key set");
        assert(isBrowserResearchLiveReady(), "all gates pass");
      },
    );
  });

  await run("Stagehand LLM config matches SiliconFlow adapter source of truth", async () => {
    await withEnv({ AI_RUNTIME_V2_PROVIDER_PREF: "auto" }, () => {
      const adapterModel = resolveSiliconFlowRuntimeModel({ runtimeMode: "balanced" });
      const stagehandPrimary = resolveSiliconFlowStagehandPrimaryModel();
      assert(adapterModel === stagehandPrimary, "expected same primary model id");
      const [first] = listStagehandLlmCandidates();
      assert(Boolean(first), "expected at least one candidate");
      assert(first!.modelId === adapterModel, "expected first candidate to use adapter model");
      assert(first!.baseURL === SILICONFLOW_API_BASE_URL, "expected /v1 SiliconFlow baseURL");
      assert(
        first!.modelId !== "MiniMaxAI/MiniMax-M2.5" || adapterModel === "MiniMaxAI/MiniMax-M2.5",
        "should not use catalog long-context model unless adapter resolves it",
      );
    });
  });

  await run("routeCapability browserbase LLM uses adapter model not catalog-only pick", () => {
    const route = routeCapability({
      capability: "browser_research",
      researchProvider: "browserbase",
      runtimeMode: "balanced",
    });
    const adapterModel = resolveSiliconFlowRuntimeModel({ runtimeMode: "balanced" });
    if (route.providerRoute === "siliconflow_direct") {
      assert(route.modelId === adapterModel, "expected adapter-resolved model in route");
    }
  });

  await run("browserbase provider without API key throws", async () => {
    await withEnv({ BROWSERBASE_API_KEY: undefined }, async () => {
      let threw = false;
      try {
        await runBrowserbaseBrowserResearchProvider("test query", { runId: "br_test_no_key" });
      } catch (error) {
        threw = true;
        assert(
          error instanceof Error && error.message.includes("BROWSERBASE_API_KEY"),
          "expected missing key error",
        );
      }
      assert(threw, "expected throw");
    });
  });

  await run("forced browserbase failure falls back via orchestrator-style mock path", async () => {
    setBrowserbaseProviderTestHooks({
      createStagehand: () => {
        throw new Error("forced browserbase session failure");
      },
    });
    try {
      await withEnv(
        {
          BROWSERBASE_API_KEY: "test-key",
          AI_RUNTIME_V2_MODE: "on",
          BROWSER_RESEARCH_LIVE_ENABLED: "true",
          BROWSER_RESEARCH_PROVIDER: "browserbase",
        },
        async () => {
          let threw = false;
          try {
            await runBrowserbaseBrowserResearchProvider("forced failure probe", {
              runId: "br_forced_fail",
            });
          } catch {
            threw = true;
          }
          assert(threw, "expected provider throw before orchestrator fallback");
        },
      );
    } finally {
      setBrowserbaseProviderTestHooks(null);
    }
  });

  await run("cancel terminates registered live session", async () => {
    let closed = false;
    registerBrowserResearchLiveSession({
      runId: "br_cancel_test",
      abortController: new AbortController(),
      close: async () => {
        closed = true;
      },
    });
    await terminateBrowserResearchLiveSession("br_cancel_test");
    assert(closed, "expected close to run on cancel");
    await closeBrowserbaseSessionForRun("br_cancel_test");
  });

  await run("UI copy includes browserbase label without forbidden phrases", () => {
    assert(BROWSER_RESEARCH_UI_COPY.browserbaseRunLabel.includes("Browserbase"), "label");
    const copy = Object.values(BROWSER_RESEARCH_UI_COPY).join(" ");
    const lower = copy.toLowerCase();
    for (const phrase of BROWSER_RESEARCH_FORBIDDEN_COPY) {
      assert(!lower.includes(phrase), `forbidden copy: ${phrase}`);
    }
  });

  await run("mock provider still works as terminal fallback", () => {
    const mock = runMockBrowserResearchProvider("fallback probe");
    assert(mock.provider === "mock", "expected mock provider");
    assert(mock.mockSources.length > 0, "expected sources");
    assert(!("evidenceIds" in mock && mock.evidenceIds?.length), "mock should not capture evidence");
  });

  await run("evidence capture enabled by default", async () => {
    await withEnv({ BROWSER_RESEARCH_EVIDENCE_ENABLED: undefined }, () => {
      assert(isBrowserResearchEvidenceEnabled(), "expected evidence on by default");
    });
  });

  await run("screenshot failure degrades gracefully", async () => {
    await withEnv({ BROWSER_RESEARCH_EVIDENCE_ENABLED: "true" }, async () => {
      const page = {
        screenshot: async () => {
          throw new Error("forced screenshot failure");
        },
      };
      const evidenceId = await captureBrowserResearchPageEvidenceSafely({
        client: {} as never,
        workspaceId: "ws_test",
        runId: "br_evidence_fail",
        page: page as never,
        sourceUrl: "https://example.com",
        sourceTitle: "Example",
      });
      assert(evidenceId === null, "expected null when screenshot fails");
    });
  });

  await run("live browse LLM cost uses catalog model id (gateway pricing path)", () => {
    const gatewayCost = estimateCost("openai/gpt-4o-mini", 1200, 400);
    const siliconCost = estimateCost("MiniMaxAI/MiniMax-M2.5", 1200, 400);
    assert(gatewayCost > 0, "expected positive gateway cost");
    assert(gatewayCost !== siliconCost, "gateway and silicon catalog rates should differ");
  });

  await run("research report artifact saves citations from run sources", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      let artifactInsert: Record<string, unknown> | null = null;
      const mockClient = {
        from: (table: string) => ({
          insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
            if (table === "artifacts") {
              artifactInsert = payload as Record<string, unknown>;
              return {
                select: () => ({
                  single: async () => ({
                    data: {
                      id: "art_test_report",
                      workspace_id: "ws_test",
                      room_id: "room_test",
                      topic_id: "topic_test",
                      title: (payload as Record<string, unknown>).title,
                      artifact_type: (payload as Record<string, unknown>).artifact_type,
                      status: (payload as Record<string, unknown>).status,
                      content_markdown: (payload as Record<string, unknown>).content_markdown,
                      content_json: (payload as Record<string, unknown>).content_json,
                      source_citations: (payload as Record<string, unknown>).source_citations,
                      created_by_type: (payload as Record<string, unknown>).created_by_type,
                      created_by_id: (payload as Record<string, unknown>).created_by_id,
                      metadata: {},
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              };
            }
            return Promise.resolve({ error: null });
          },
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        }),
        storage: {
          from: () => ({
            upload: async () => ({ error: null }),
          }),
        },
      } as never;

      const report = await createResearchReportArtifactFromRun({
        client: mockClient,
        run: {
          id: "br_report_test",
          workspaceId: "ws_test",
          roomId: "room_test",
          topicId: "topic_test",
          employeeId: "emp_test",
          createdBy: "user_test",
          query: "What is Browserbase?",
          findings: [{ title: "Finding", summary: "Browser automation infra." }],
          mockSources: [
            {
              title: "Browserbase docs",
              url: "https://docs.browserbase.com",
              note: "Hosted browser sessions.",
              evidenceId: "ev_test",
            },
          ],
          workUnitId: "wu_test",
        },
        evidenceIds: ["ev_test"],
        stagehandLlmProvider: "vercel_gateway",
        stagehandModelId: "openai/gpt-4o-mini",
      });

      assert(report?.artifactId === "art_test_report", "expected artifact id");
      assert(Boolean(artifactInsert), "expected artifact insert");
      const citations = artifactInsert!.source_citations as Array<{
        url?: string;
        fileName?: string;
      }>;
      assert(citations[0]?.url === "https://docs.browserbase.com", "expected citation url");
      assert(citations[0]?.fileName === "Browserbase docs", "expected citation title");
    });
  });

  const liveKey = process.env.BROWSERBASE_API_KEY?.trim();
  const liveEnabled = process.env.BROWSER_RESEARCH_LIVE_ENABLED?.trim().toLowerCase() === "true";

  if (!liveKey) {
    skip("[LIVE] Browserbase smoke", "SKIPPED: BROWSERBASE_API_KEY not configured");
  } else if (!liveEnabled) {
    skip(
      "[LIVE] Browserbase smoke",
      "SKIPPED: set BROWSER_RESEARCH_LIVE_ENABLED=true for live smoke",
    );
  } else {
    await run("[LIVE] Browserbase + Stagehand end-to-end smoke", async () => {
      await withEnv(
        {
          AI_RUNTIME_V2_MODE: "on",
          BROWSER_RESEARCH_PROVIDER: "browserbase",
          BROWSER_RESEARCH_LIVE_ENABLED: "true",
          BROWSER_RESEARCH_MAX_PAGES: "1",
          BROWSER_RESEARCH_MAX_SECONDS: "120",
        },
        async () => {
          assert(isBrowserResearchLiveReady(), "live gates must pass for smoke");
          const result = await runBrowserbaseBrowserResearchProvider(
            "What is Browserbase used for?",
            { runId: "br_live_smoke", workspaceId: "ws_smoke", employeeId: "emp_smoke" },
          );
          assert(result.provider === "browserbase", "expected browserbase provider");
          assert(result.mockSources.length >= 1, "expected real source cards");
          assert(result.findings.length >= 1, "expected real findings");
          assert(result.findings[0]!.summary.trim().length > 0, "expected non-empty finding");
          assert(Boolean(result.liveSessionUrl), "expected Browserbase session URL");
          assert(Boolean(result.stagehandModelId), "expected stagehand model id for cost path");
          console.log(`      Browserbase session: ${result.liveSessionUrl}`);
          console.log(
            `      Stagehand LLM: ${result.stagehandLlmProvider ?? "unknown"} / ${result.stagehandModelId ?? "unknown"}`,
          );
          assert(!getBrowserResearchLiveSession("br_live_smoke"), "session registry should be clean after close");
        },
      );
    });
  }

  console.log(`\n--- Summary ---\nPASS: ${passed}  SKIP: ${skipped}  TOTAL: ${passed + skipped}`);
}

main().catch(() => {
  process.exitCode = 1;
});
