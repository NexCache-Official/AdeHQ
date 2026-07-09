/**
 * V20.0.6 — Gateway search answer quality tests.
 * Usage: npm run test:search-answer-quality
 */

import { decideSearchRoute } from "@/lib/ai/search/search-router";
import { getFastFactSearchPreset } from "@/lib/ai/search/config";
import { shouldReturnNoSourcesMessage } from "@/lib/ai/search/search-answer";
import { extractSourcesFromGenerateTextResult } from "@/lib/ai/search/vercel-gateway-search";
import {
  normalizeGatewaySearchSources,
  rankSearchSources,
  filterLowQualitySources,
  isUnrelatedSource,
  ensurePrivateCompanyWording,
  stripInlineSourcesSection,
} from "@/lib/ai/search/source-normalizer";

function expectTrue(condition: boolean, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function main() {
  await test("Perplexity revenue query routes to fast_fact preset", () => {
    const decision = decideSearchRoute("What was Perplexity's revenue in 2025?");
    expectTrue(decision.searchMode === "fast_fact");
    expectTrue(!decision.browserRequired);
    expectTrue(decision.route !== "browserbase");
    const preset = getFastFactSearchPreset();
    expectTrue(preset.maxResults >= 4 && preset.maxResults <= 5);
    expectTrue(preset.synthesisMaxOutputTokens <= 800);
  });

  await test("sources normalize into ranked source cards", () => {
    const normalized = normalizeGatewaySearchSources(
      [
        { title: "Perplexity revenue - Sacra", url: "https://sacra.co/c/perplexity/" },
        { title: "Perplexity Revenue and Usage Statistics (2026)", url: "https://businessofapps.com/data/perplexity-statistics/" },
      ],
      "What was Perplexity's revenue in 2025?",
    );
    expectTrue(normalized.used.length > 0);
    expectTrue(normalized.used[0].domain.length > 0);
    expectTrue(normalized.used[0].confidence === "high" || normalized.used[0].confidence === "medium");
  });

  await test("unrelated X/ticker source is excluded", () => {
    const reason = isUnrelatedSource("What was Perplexity's revenue in 2025?", {
      title: "Q2 2025 revenue guidance - X (PPLXfinance)",
      url: "https://x.com/PPLXfinance/status/123",
      domain: "x.com",
      snippet: "Ticker guidance unrelated",
    });
    expectTrue(Boolean(reason));
    const normalized = normalizeGatewaySearchSources(
      [
        {
          title: "Q2 2025 revenue guidance - X (PPLXfinance)",
          url: "https://x.com/PPLXfinance/status/123",
        },
        { title: "Perplexity revenue - Sacra", url: "https://sacra.co/c/perplexity/" },
      ],
      "What was Perplexity's revenue in 2025?",
    );
    expectTrue(normalized.excludedSourceCount >= 1);
    expectTrue(!normalized.used.some((source) => source.domain === "x.com"));
  });

  await test("source ranking prefers data providers over SEO blogs", () => {
    const ranked = rankSearchSources([
      {
        id: "1",
        title: "Perplexity Revenue and Usage Statistics",
        url: "https://businessofapps.com/data/perplexity-statistics/",
        domain: "businessofapps.com",
        sourceType: "seo_blog",
        confidence: "low",
        usedInAnswer: false,
      },
      {
        id: "2",
        title: "Perplexity revenue, valuation & funding",
        url: "https://sacra.co/c/perplexity/",
        domain: "sacra.co",
        sourceType: "data_provider",
        confidence: "high",
        usedInAnswer: false,
      },
    ]);
    expectTrue(ranked[0].domain === "sacra.co");
  });

  await test("private-company revenue answer includes cautious wording helper", () => {
    const answer = ensurePrivateCompanyWording(
      "Perplexity likely reached about $200M run-rate by late 2025.",
      "What was Perplexity's revenue in 2025?",
      "company_fact",
    );
    expectTrue(/estimated|reported|private|arr|run-rate|audited/i.test(answer));
  });

  await test("inline sources section is stripped for cards UI", () => {
    const stripped = stripInlineSourcesSection(
      "Answer body.\n\n**Sources**\n- [Sacra](https://sacra.co/c/perplexity/)",
    );
    expectTrue(!/\*\*Sources\*\*/i.test(stripped));
    expectTrue(stripped.startsWith("Answer body."));
  });

  await test("search answers without sources are always rejected", () => {
    const answer =
      "Apple reported approximately $391 billion in revenue for fiscal 2025, based on its annual earnings release.";
    expectTrue(
      shouldReturnNoSourcesMessage(answer, { usedSourceCount: 0, sourceCount: 0 }),
      "expected unsourced factual answer to be rejected",
    );
    expectTrue(
      !shouldReturnNoSourcesMessage(answer, { usedSourceCount: 1, sourceCount: 1 }),
      "expected sourced answer to pass",
    );
  });

  await test("gateway result sources extract from AI SDK source parts and tool output", () => {
    const extracted = extractSourcesFromGenerateTextResult({
      sources: [
        {
          sourceType: "url",
          url: "https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/",
          title: "Apple reports Q4 results",
        },
      ],
      steps: [
        {
          toolResults: [
            {
              output: {
                results: [
                  {
                    title: "Apple Investor Relations",
                    url: "https://investor.apple.com/",
                    snippet: "Revenue and earnings data.",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expectTrue(extracted.length >= 2);
    expectTrue(extracted.some((source) => source.url.includes("apple.com/newsroom")));
    expectTrue(extracted.some((source) => source.url.includes("investor.apple.com")));
  });

  await test("filterLowQualitySources removes unrelated entries", () => {
    const cards = [
      {
        id: "a",
        title: "Sacra profile",
        url: "https://sacra.co/c/perplexity/",
        domain: "sacra.co",
        sourceType: "data_provider" as const,
        confidence: "high" as const,
        usedInAnswer: false,
      },
      {
        id: "b",
        title: "PPLX ticker guidance",
        url: "https://x.com/PPLXfinance/status/1",
        domain: "x.com",
        sourceType: "social" as const,
        confidence: "low" as const,
        usedInAnswer: false,
      },
    ];
    const filtered = filterLowQualitySources(cards, "What was Perplexity's revenue in 2025?");
    expectTrue(filtered.used.length === 1);
    expectTrue(filtered.excluded.length === 1);
  });

  console.log("\nAll search answer quality tests passed.");
}

main().catch(() => process.exit(1));
