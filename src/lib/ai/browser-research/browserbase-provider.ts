import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { Stagehand } from "@browserbasehq/stagehand";
import { estimateCost } from "@/lib/ai/model-catalog";
import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import type { BrowserResearchProviderResult } from "./provider-result";
import { captureBrowserResearchPageEvidenceSafely } from "./evidence-capture";
import {
  getBrowserResearchMaxPages,
  getBrowserResearchMaxSeconds,
  getBrowserbaseSessionCostUsd,
  isBrowserbaseConfigured,
} from "./provider-config";
import {
  isBrowserResearchRunAbortRequested,
  registerBrowserResearchLiveSession,
  terminateBrowserResearchLiveSession,
  unregisterBrowserResearchLiveSession,
} from "./session-registry";
import { listStagehandLlmCandidates, type StagehandLlmCandidate } from "./stagehand-llm-config";
import { tavilySearch } from "./tavily-provider";
import type { BrowserResearchMockSource } from "./types";
import { resolveProviderCredential } from "@/lib/providers/credentials/resolve-provider-credential";
import type { ResolvedCredential } from "@/lib/providers/credentials/types";

const pageExtractionSchema = z.object({
  pageTitle: z.string().describe("The page title"),
  summary: z
    .string()
    .describe("A concise summary of page content relevant to the research query"),
  keyPoints: z
    .array(z.string())
    .max(3)
    .describe("Up to three bullet points relevant to the research query"),
});

const searchLinksSchema = z.object({
  links: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
      }),
    )
    .max(8),
});

export type BrowserbaseProviderTestHooks = {
  createStagehand?: (options: ConstructorParameters<typeof Stagehand>[0]) => Stagehand;
  discoverUrls?: (query: string) => Promise<Array<{ title: string; url: string }>>;
};

let browserbaseProviderTestHooks: BrowserbaseProviderTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setBrowserbaseProviderTestHooks(hooks: BrowserbaseProviderTestHooks | null): void {
  browserbaseProviderTestHooks = hooks;
}

function getStagehandCacheDir(): string {
  const configured = process.env.BROWSERBASE_STAGEHAND_CACHE_DIR?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), ".cache/stagehand/browser-research");
}

function assertNotAborted(runId: string): void {
  if (isBrowserResearchRunAbortRequested(runId)) {
    throw new Error("Browser research run was cancelled.");
  }
}

async function discoverResearchUrls(query: string): Promise<Array<{ title: string; url: string }>> {
  if (browserbaseProviderTestHooks?.discoverUrls) {
    return browserbaseProviderTestHooks.discoverUrls(query);
  }

  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  if (tavilyKey) {
    const response = await tavilySearch({
      query,
      apiKey: tavilyKey,
      maxResults: getBrowserResearchMaxPages() + 2,
    });
    const results = (response.results ?? [])
      .filter((row) => row.url?.trim())
      .map((row) => ({
        title: row.title.trim() || row.url,
        url: row.url.trim(),
      }));
    if (results.length > 0) return results;
  }

  return [
    {
      title: "DuckDuckGo search",
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    },
  ];
}

async function dismissCookieBannerIfPresent(stagehand: Stagehand): Promise<void> {
  const observed = await stagehand.observe(
    "click the accept or dismiss button on a cookie consent banner if one is visible",
  );
  if (observed.length > 0) {
    await stagehand.act(observed[0]!);
  }
}

function estimateBrowserbaseWorkMinutes(costUsd: number, pagesVisited: number): number {
  const fromCost = estimateWorkMinutesFromCost(costUsd);
  const perPage = pagesVisited * 2;
  return Math.max(1, Math.round((fromCost + perPage) * 100) / 100);
}

export type RunBrowserbaseBrowserResearchOptions = {
  runId: string;
  workspaceId?: string;
  roomId?: string;
  topicId?: string;
  employeeId?: string;
  workUnitId?: string;
  createdByUserId?: string;
  client?: SupabaseClient;
  onLiveSessionReady?: (liveSessionUrl: string) => void | Promise<void>;
};

function isStagehandLlmRouteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("404") ||
    lower.includes("ai_apicallerror") ||
    lower.includes("model") && lower.includes("does not exist")
  );
}

function logStagehandLlmFailure(candidate: StagehandLlmCandidate, error: unknown): void {
  const modelName =
    typeof candidate.model === "string" ? candidate.model : candidate.model.modelName;
  console.warn("[AdeHQ browser research] Stagehand LLM request failed", {
    providerRoute: candidate.providerRoute,
    modelId: candidate.modelId,
    baseURL: candidate.baseURL ?? "(gateway default)",
    modelName,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function runLiveBrowserResearchSession(
  query: string,
  options: RunBrowserbaseBrowserResearchOptions,
  candidate: StagehandLlmCandidate,
  browserbaseCredential?: ResolvedCredential,
): Promise<
  BrowserResearchProviderResult & {
    liveSessionUrl?: string;
    stagehandLlmProvider: string;
    stagehandModelId: string;
  }
> {
  const trimmed = query.trim();
  const maxPages = getBrowserResearchMaxPages();
  const maxSeconds = getBrowserResearchMaxSeconds();
  const deadline = Date.now() + maxSeconds * 1000;

  const plannedSteps = [
    {
      title: "Plan live research scope (Browserbase)",
      description: `Break down "${trimmed.slice(0, 64)}" into source targets. Live browser session — capped at ${maxPages} pages.`,
    },
    {
      title: "Discover source URLs",
      description: "Use Tavily search when configured, otherwise open a lightweight search page.",
    },
    {
      title: "Browse and extract findings",
      description:
        "Open a Browserbase session, visit each source, extract structured summaries, then close the session.",
    },
  ];

  const sourcesToVisit = (await discoverResearchUrls(trimmed)).slice(0, maxPages);
  const mockSources: BrowserResearchMockSource[] = [];
  const findings: BrowserResearchProviderResult["findings"] = [];
  const evidenceIds: string[] = [];

  let stagehand: Stagehand | null = null;
  const abortController = new AbortController();

  registerBrowserResearchLiveSession({
    runId: options.runId,
    abortController,
    close: async () => {
      if (stagehand) {
        await stagehand.close({ force: true }).catch(() => undefined);
      }
    },
  });

  try {
    assertNotAborted(options.runId);

    const stagehandFactory =
      browserbaseProviderTestHooks?.createStagehand ??
      ((opts: ConstructorParameters<typeof Stagehand>[0]) => new Stagehand(opts));

    stagehand = stagehandFactory({
      env: "BROWSERBASE",
      apiKey: browserbaseCredential?.apiKey ?? process.env.BROWSERBASE_API_KEY?.trim(),
      model: candidate.model,
      cacheDir: getStagehandCacheDir(),
      verbose: 0,
      disablePino: true,
    });

    await stagehand.init();
    const liveSessionUrl = stagehand.browserbaseSessionURL;
    if (liveSessionUrl && options.onLiveSessionReady) {
      await options.onLiveSessionReady(liveSessionUrl);
    }
    const page = stagehand.context.pages()[0];
    if (!page) {
      throw new Error("Browserbase session did not expose a page.");
    }

    recordAiRuntime({
      provider: "browserbase",
      model: candidate.modelId,
      mode: "live",
      workspaceId: options.workspaceId,
      employeeId: options.employeeId,
      agentRunId: options.workUnitId ?? options.runId,
      estimatedCostUsd: getBrowserbaseSessionCostUsd(),
      fallbackReason: "browser_research_live_session",
    });

    for (const source of sourcesToVisit) {
      assertNotAborted(options.runId);
      if (Date.now() > deadline) {
        throw new Error(`Browser research exceeded ${maxSeconds}s time limit.`);
      }

      await page.goto(source.url, {
        waitUntil: "domcontentloaded",
        timeoutMs: Math.min(30_000, deadline - Date.now()),
      });

      await dismissCookieBannerIfPresent(stagehand);

      const extracted = await stagehand.extract(
        `Extract a concise summary of this page relevant to the research query: ${JSON.stringify(trimmed)}`,
        pageExtractionSchema,
      );

      const sourceTitle = extracted.pageTitle || source.title;
      const sourceUrl = page.url() || source.url;
      let evidenceId: string | null = null;
      if (options.client && options.workspaceId) {
        evidenceId = await captureBrowserResearchPageEvidenceSafely({
          client: options.client,
          workspaceId: options.workspaceId,
          roomId: options.roomId,
          topicId: options.topicId,
          runId: options.runId,
          page,
          sourceUrl,
          sourceTitle,
          createdByUserId: options.createdByUserId,
        });
        if (evidenceId) evidenceIds.push(evidenceId);
      }

      mockSources.push({
        title: sourceTitle,
        url: sourceUrl,
        note: extracted.summary.slice(0, 280),
        evidenceId: evidenceId ?? undefined,
      });

      for (const point of extracted.keyPoints.slice(0, 2)) {
        findings.push({
          title: extracted.pageTitle || source.title,
          summary: point,
        });
      }

      if (findings.length >= maxPages * 2) break;
    }

    if (mockSources.length === 0 && sourcesToVisit[0]?.url.includes("duckduckgo")) {
      const searchExtract = await stagehand.extract(
        `Extract up to ${maxPages} relevant result links with titles for the query ${JSON.stringify(trimmed)}`,
        searchLinksSchema,
      );

      for (const link of searchExtract.links.slice(0, maxPages)) {
        assertNotAborted(options.runId);
        if (Date.now() > deadline) break;

        await page.goto(link.url, {
          waitUntil: "domcontentloaded",
          timeoutMs: Math.min(30_000, deadline - Date.now()),
        });
        await dismissCookieBannerIfPresent(stagehand);

        const extracted = await stagehand.extract(
          `Extract a concise summary relevant to: ${JSON.stringify(trimmed)}`,
          pageExtractionSchema,
        );

        const sourceTitle = extracted.pageTitle || link.title;
        const sourceUrl = page.url() || link.url;
        let evidenceId: string | null = null;
        if (options.client && options.workspaceId) {
          evidenceId = await captureBrowserResearchPageEvidenceSafely({
            client: options.client,
            workspaceId: options.workspaceId,
            roomId: options.roomId,
            topicId: options.topicId,
            runId: options.runId,
            page,
            sourceUrl,
            sourceTitle,
            createdByUserId: options.createdByUserId,
          });
          if (evidenceId) evidenceIds.push(evidenceId);
        }

        mockSources.push({
          title: sourceTitle,
          url: sourceUrl,
          note: extracted.summary.slice(0, 280),
          evidenceId: evidenceId ?? undefined,
        });
        findings.push({
          title: extracted.pageTitle || link.title,
          summary: extracted.summary.slice(0, 400),
        });
      }
    }

    if (findings.length === 0 && mockSources.length > 0) {
      findings.push({
        title: "Live research summary",
        summary: mockSources.map((s) => s.note).join(" ").slice(0, 500),
      });
    }

    if (mockSources.length === 0 || findings.length === 0) {
      throw new Error("Live browser research returned no source cards or findings.");
    }

    const metrics = await stagehand.metrics;
    const promptTokens = metrics?.totalPromptTokens ?? 0;
    const completionTokens = metrics?.totalCompletionTokens ?? 0;
    const llmCostUsd = estimateCost(candidate.modelId, promptTokens, completionTokens);
    const estimatedCostUsd =
      Math.round((getBrowserbaseSessionCostUsd() + llmCostUsd) * 1_000_000) / 1_000_000;
    const estimatedWorkMinutes = estimateBrowserbaseWorkMinutes(
      estimatedCostUsd,
      mockSources.length,
    );

    recordAiRuntime({
      provider: candidate.providerRoute === "vercel_gateway" ? "vercel_gateway" : "browserbase",
      model: candidate.modelId,
      mode: "live",
      workspaceId: options.workspaceId,
      employeeId: options.employeeId,
      agentRunId: options.workUnitId ?? options.runId,
      estimatedCostUsd,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    });

    if (liveSessionUrl) {
      console.log("[AdeHQ browser research] Browserbase session:", liveSessionUrl);
    }

    return {
      plannedSteps,
      mockSources,
      findings,
      estimatedWorkMinutes,
      estimatedCostUsd,
      provider: "browserbase",
      resultCount: mockSources.length,
      liveSessionUrl,
      stagehandLlmProvider: candidate.providerRoute,
      stagehandModelId: candidate.modelId,
      evidenceIds,
    };
  } finally {
    try {
      if (stagehand) {
        await stagehand.close({ force: true });
      }
    } catch (error) {
      console.warn("[AdeHQ browser research] stagehand close", error);
    }
    unregisterBrowserResearchLiveSession(options.runId);
  }
}

/** Live Browserbase + Stagehand v3 research — one session per run, capped pages/time. */
export async function runBrowserbaseBrowserResearchProvider(
  query: string,
  options: RunBrowserbaseBrowserResearchOptions,
): Promise<
  BrowserResearchProviderResult & {
    liveSessionUrl?: string;
    stagehandLlmProvider?: string;
  }
> {
  const browserbaseCredential = await resolveProviderCredential({
    workspaceId: options.workspaceId,
    provider: "browserbase",
    client: options.client,
  }).catch(() => null);

  if (!browserbaseCredential && !isBrowserbaseConfigured()) {
    throw new Error("BROWSERBASE_API_KEY is not configured.");
  }

  const candidates = await listStagehandLlmCandidates(options.workspaceId);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const result = await runLiveBrowserResearchSession(query, options, candidate, browserbaseCredential ?? undefined);
      console.log("[AdeHQ browser research] Stagehand LLM succeeded", {
        providerRoute: candidate.providerRoute,
        modelId: candidate.modelId,
        baseURL: candidate.baseURL ?? "(gateway default)",
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logStagehandLlmFailure(candidate, error);
      if (!isStagehandLlmRouteError(error)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("All Stagehand LLM candidates failed.");
}

/** Force-close helper for cancel route — delegates to session registry. */
export async function closeBrowserbaseSessionForRun(runId: string): Promise<void> {
  await terminateBrowserResearchLiveSession(runId);
}
