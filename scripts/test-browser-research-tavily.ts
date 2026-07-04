/**
 * V20.0.1 — Tavily browser research provider tests.
 *
 * Usage: npm run test:browser-research:tavily
 */

import {
  BROWSER_RESEARCH_FORBIDDEN_COPY,
  BROWSER_RESEARCH_UI_COPY,
  estimateTavilyResearchWorkMinutes,
  getBrowserResearchProviderConfig,
  isTavilyConfigured,
  mapTavilyResultsToSourceCards,
  resolveBrowserResearchProvider,
  runTavilyBrowserResearchProvider,
  type TavilySearchResponse,
} from "@/lib/ai/browser-research";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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

function assertNoForbiddenCopy(text: string) {
  const lower = text.toLowerCase();
  for (const phrase of BROWSER_RESEARCH_FORBIDDEN_COPY) {
    assert(!lower.includes(phrase), `forbidden copy found: "${phrase}"`);
  }
}

const MOCK_TAVILY_RESPONSE: TavilySearchResponse = {
  query: "AdeHQ competitors",
  results: [
    {
      title: "Competitor A Overview",
      url: "https://example.com/competitor-a",
      content: "Competitor A offers team AI collaboration tools.",
      score: 0.91,
    },
    {
      title: "Market landscape for AI workforce tools",
      url: "https://example.com/landscape",
      content: "Several startups compete in AI employee orchestration.",
      score: 0.84,
    },
  ],
};

async function main() {
  console.log("AdeHQ Browser Research Tavily — V20.0.1\n");

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

  await run("default provider pref is mock", async () => {
    await withEnv({ BROWSER_RESEARCH_PROVIDER: undefined, TAVILY_API_KEY: undefined }, () => {
      assert(getBrowserResearchProviderConfig().providerPref === "mock", "expected mock pref");
      assert(resolveBrowserResearchProvider().provider === "mock", "expected mock effective");
    });
  });

  await run("tavily pref without key falls back to mock", async () => {
    await withEnv(
      { BROWSER_RESEARCH_PROVIDER: "tavily", TAVILY_API_KEY: undefined },
      () => {
        const resolved = resolveBrowserResearchProvider();
        assert(resolved.provider === "mock", "expected mock fallback");
        assert(resolved.fallbackReason === "tavily_key_missing", "expected fallback reason");
      },
    );
  });

  await run("tavily pref with key resolves to tavily", async () => {
    await withEnv(
      { BROWSER_RESEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "test-tavily-key" },
      () => {
        assert(isTavilyConfigured(), "expected tavily configured");
        assert(resolveBrowserResearchProvider().provider === "tavily", "expected tavily");
      },
    );
  });

  await run("maps Tavily results to existing source-card shape", () => {
    const cards = mapTavilyResultsToSourceCards(MOCK_TAVILY_RESPONSE.results ?? []);
    assert(cards.length === 2, "expected two source cards");
    assert(cards[0]!.title === "Competitor A Overview", "expected title");
    assert(cards[0]!.url.startsWith("https://"), "expected real URL");
    assert(typeof cards[0]!.note === "string" && cards[0]!.note.length > 0, "expected note/snippet");
    assert(!cards[0]!.title.includes("[Mock]"), "tavily cards must not use mock prefix");
  });

  await run("work-minute estimate uses cost + result count", () => {
    const minutes = estimateTavilyResearchWorkMinutes(0.008, 3);
    assert(minutes >= 1, "expected at least 1 minute");
    assert(minutes > estimateTavilyResearchWorkMinutes(0.008, 0), "more results should add minutes");
  });

  await run("mocked Tavily provider returns real-shaped sources and findings", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(MOCK_TAVILY_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await runTavilyBrowserResearchProvider("AdeHQ competitors", {
      apiKey: "test-key",
      fetchImpl: mockFetch,
    });

    assert(result.provider === "tavily", "expected tavily provider");
    assert(result.mockSources.length === 2, "expected mapped source cards");
    assert(result.findings.length >= 1, "expected findings from snippets");
    assert(result.estimatedWorkMinutes >= 1, "expected positive work minutes");
    assert(result.estimatedCostUsd > 0, "expected positive cost estimate");
    assert(result.plannedSteps.length === 3, "expected planned steps");
    for (const source of result.mockSources) {
      assertNoForbiddenCopy(`${source.title} ${source.note}`);
    }
  });

  await run("UI copy distinguishes mock vs tavily without live browsing claims", () => {
    assert(BROWSER_RESEARCH_UI_COPY.mockRunLabel.includes("Mock"), "mock label");
    assert(BROWSER_RESEARCH_UI_COPY.tavilyRunLabel.includes("Tavily"), "tavily label");
    assert(BROWSER_RESEARCH_UI_COPY.liveLater.includes("Live web browsing"), "live later copy");
    assertNoForbiddenCopy(Object.values(BROWSER_RESEARCH_UI_COPY).join(" "));
  });

  const liveKey = process.env.TAVILY_API_KEY?.trim();
  if (!liveKey) {
    skip("[LIVE] Tavily search smoke", "SKIPPED: TAVILY_API_KEY not configured");
  } else {
    await run("[LIVE] Tavily search smoke", async () => {
      const result = await runTavilyBrowserResearchProvider("AdeHQ AI workforce tools", {
        apiKey: liveKey,
      });
      assert(result.provider === "tavily", "expected tavily provider");
      assert(result.mockSources.length > 0, "expected at least one real source");
      assert(result.mockSources[0]!.url.startsWith("http"), "expected real URL");
    });
  }

  console.log(`\n--- Summary ---\nPASS: ${passed}  SKIP: ${skipped}  FAIL: 0  TOTAL: ${passed + skipped}`);
}

main().catch(() => {
  process.exitCode = 1;
});
