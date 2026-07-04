/**
 * V19.9.1b — Work Hours shadow UI formatting + client tests.
 *
 * Usage: npm run test:work-hours:ui
 */

import {
  assertNoForbiddenBillingCopy,
  collectWorkHoursShadowUiCopy,
  formatCapabilityLabel,
  formatEstimatedHours,
  formatEstimatedMinutes,
  formatWorkTypeLabel,
  isEmptyShadowSummary,
  WORK_HOURS_SHADOW_BADGE,
} from "@/lib/work-hours/labels";
import {
  fetchWorkHoursShadowSummary,
  WorkHoursShadowFetchError,
} from "@/lib/work-hours/client";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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
  console.log("AdeHQ Work Hours Shadow UI — V19.9.1b\n");

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  await run("formats minutes/hours correctly", () => {
    assert(formatEstimatedMinutes(123.4) === "123", "minutes should round to whole");
    assert(formatEstimatedMinutes(123.6) === "124", "minutes should round up");
    assert(formatEstimatedHours(2.06) === "2.1", "hours should round to 1 decimal");
    assert(formatEstimatedHours(0.04) === "0.0", "small hours should show one decimal");
  });

  await run("empty state detection works", () => {
    assert(
      isEmptyShadowSummary({
        totalEstimatedMinutes: 0,
        byEmployee: [],
        byCapability: [],
        byWorkType: [],
      }),
      "expected empty summary",
    );
    assert(
      !isEmptyShadowSummary({
        totalEstimatedMinutes: 0.5,
        byEmployee: [],
        byCapability: [],
        byWorkType: [],
      }),
      "non-zero minutes should not be empty",
    );
  });

  await run("required shadow label is present in UI copy set", () => {
    const copy = collectWorkHoursShadowUiCopy();
    assert(copy.includes(WORK_HOURS_SHADOW_BADGE), "badge copy missing");
    assert(copy.some((line) => line.includes("Shadow estimate — not billed")), "exact badge missing");
  });

  await run("capability labels are human-readable", () => {
    assert(formatCapabilityLabel("summarization") === "Summaries", "summarization label");
    assert(formatCapabilityLabel("structured_chat") === "Structured replies", "structured_chat label");
    assert(formatCapabilityLabel("embedding") === "File understanding", "embedding label");
    assert(formatCapabilityLabel("quick_reply") === "Quick replies", "quick_reply label");
    assert(formatCapabilityLabel("artifact_generation") === "Artifacts", "artifact label");
  });

  await run("work type labels are human-readable", () => {
    assert(formatWorkTypeLabel("topic_summary") === "Topic summaries", "topic_summary label");
    assert(formatWorkTypeLabel("orchestration_classify") === "Orchestration", "orchestration label");
    assert(formatWorkTypeLabel("employee_direct_response") === "Direct replies", "direct replies label");
    assert(formatWorkTypeLabel("employee_queued_response_shadow") === "Queued replies shadow", "queued shadow label");
  });

  await run("fetch helper handles API error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      let threw = false;
      try {
        await fetchWorkHoursShadowSummary("ws_test", { headers: {} });
      } catch (error) {
        threw = error instanceof WorkHoursShadowFetchError;
        if (error instanceof WorkHoursShadowFetchError) {
          assert(error.status === 403, "expected status 403");
          assert(error.message === "Forbidden", "expected API error message");
        }
      }
      assert(threw, "expected fetch helper to throw");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await run("UI copy avoids billing/limit language", () => {
    const copy = collectWorkHoursShadowUiCopy().join("\n");
    assert(assertNoForbiddenBillingCopy(copy), `forbidden billing copy found in:\n${copy}`);
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
