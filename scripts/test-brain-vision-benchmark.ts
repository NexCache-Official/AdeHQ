/**
 * PR-15 — Fixed vision benchmark (≥10 per category).
 *
 * Offline (default): builds a 60-item fixture set, validates manifest + normalize/
 * confidence/routing metrics scaffolding, writes a report skeleton.
 *
 * Live (optional): ADEHQ_VISION_BENCHMARK_LIVE=1 + SILICONFLOW_API_KEY runs VL-8B
 * (and escalates when gated) and scores factual accuracy / latency / cost /
 * escalation frequency.
 *
 * Usage:
 *   npm run test:brain:vision:benchmark
 *   ADEHQ_VISION_BENCHMARK_LIVE=1 npm run test:brain:vision:benchmark
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { costUsdFromSnapshot } from "@/lib/brain/catalog/pricing-snapshots";
import {
  assessVisionConfidence,
  boundVisualBytes,
  callSiliconFlowVision,
  extractUnderstandingText,
  inferVisionNeed,
  normalizeVisualAsset,
  shouldEscalateFromStandard,
  type VisualAssetKind,
} from "@/lib/brain/vision";

const ROOT = join(process.cwd(), "scripts/fixtures/vision-benchmark");
const OUT = "/tmp/adehq-brain-vision-benchmark";

const CATEGORIES: VisualAssetKind[] = [
  "screenshot",
  "chart",
  "document_page",
  "property_product",
  "ui_bug",
  "low_quality_scan",
];

type FixtureItem = {
  id: string;
  category: VisualAssetKind;
  fileName: string;
  expectedFacts: string[];
  prompt: string;
  forceComplex?: boolean;
};

function colorFor(category: VisualAssetKind, index: number): { r: number; g: number; b: number } {
  const palette: Record<VisualAssetKind, { r: number; g: number; b: number }> = {
    screenshot: { r: 30, g: 64, b: 120 },
    chart: { r: 20, g: 100, b: 80 },
    document_page: { r: 245, g: 245, b: 240 },
    property_product: { r: 160, g: 90, b: 50 },
    ui_bug: { r: 180, g: 40, b: 40 },
    low_quality_scan: { r: 200, g: 200, b: 190 },
    other: { r: 80, g: 80, b: 80 },
  };
  const base = palette[category];
  return {
    r: Math.min(255, base.r + (index % 5) * 8),
    g: Math.min(255, base.g + (index % 3) * 6),
    b: Math.min(255, base.b + (index % 4) * 10),
  };
}

async function ensureFixtures(): Promise<FixtureItem[]> {
  mkdirSync(ROOT, { recursive: true });
  const items: FixtureItem[] = [];

  for (const category of CATEGORIES) {
    for (let i = 1; i <= 10; i += 1) {
      const id = `${category}_${String(i).padStart(2, "0")}`;
      const fileName = `${id}.png`;
      const path = join(ROOT, fileName);
      const factA = `${category.toUpperCase()}-FACT-${i}`;
      const factB = `VALUE-${i * 11}`;
      const expectedFacts = [factA, factB];
      const prompt =
        category === "ui_bug"
          ? `Debug the root cause of this UI bug. Find ${factA} and ${factB}.`
          : category === "low_quality_scan"
            ? `This is a low-quality scan. OCR every readable token including ${factA}.`
            : `What is in this ${category.replace(/_/g, " ")}? Extract ${factA} and ${factB}.`;

      if (!existsSync(path)) {
        const { r, g, b } = colorFor(category, i);
        const svg = `
          <svg width="640" height="420" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/>
            <rect x="24" y="24" width="592" height="372" fill="white" fill-opacity="0.88"/>
            <text x="40" y="80" font-size="28" font-family="Arial" fill="#111">${category}</text>
            <text x="40" y="140" font-size="22" font-family="Arial" fill="#222">${factA}</text>
            <text x="40" y="190" font-size="22" font-family="Arial" fill="#222">${factB}</text>
            <text x="40" y="250" font-size="16" font-family="Arial" fill="#444">AdeHQ vision benchmark fixture ${id}</text>
            ${
              category === "chart"
                ? `<rect x="40" y="280" width="${40 + i * 20}" height="80" fill="#2563eb"/><rect x="120" y="300" width="${30 + i * 10}" height="60" fill="#16a34a"/>`
                : ""
            }
            ${
              category === "ui_bug"
                ? `<rect x="400" y="280" width="180" height="48" fill="#ef4444"/><text x="420" y="310" font-size="18" fill="white">Broken CTA</text>`
                : ""
            }
          </svg>`;
        let pipeline = sharp(Buffer.from(svg)).png();
        if (category === "low_quality_scan") {
          pipeline = sharp(await pipeline.toBuffer())
            .blur(1.2)
            .modulate({ brightness: 0.92 })
            .png();
        }
        await pipeline.toFile(path);
      }

      items.push({
        id,
        category,
        fileName,
        expectedFacts,
        prompt,
        forceComplex: category === "ui_bug" || category === "low_quality_scan",
      });
    }
  }

  const manifestPath = join(ROOT, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ version: 1, count: items.length, items }, null, 2));
  return items;
}

function scoreFacts(text: string, expected: string[]): {
  hit: number;
  missed: string[];
  hallucinationRisk: boolean;
} {
  const lower = text.toLowerCase();
  const missed = expected.filter((f) => !lower.includes(f.toLowerCase()));
  const hit = expected.length - missed.length;
  // Crude hallucination signal: invented currency amounts not in fixture facts.
  const hallucinationRisk = /\$\d{3,}/.test(text) && !expected.some((f) => f.includes("$"));
  return { hit, missed, hallucinationRisk };
}

async function main() {
  const items = await ensureFixtures();
  assert.equal(items.length, 60, "benchmark must include 60 fixtures");
  for (const cat of CATEGORIES) {
    assert.equal(items.filter((i) => i.category === cat).length, 10, `${cat} needs 10 items`);
  }

  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as {
    count: number;
  };
  assert.equal(manifest.count, 60);

  // Offline normalize / bound checks on first of each category
  for (const cat of CATEGORIES) {
    const item = items.find((i) => i.category === cat)!;
    const bytes = readFileSync(join(ROOT, item.fileName));
    const bounded = await boundVisualBytes(bytes, "image/png");
    assert.ok(bounded.bytes.byteLength > 0);
    const asset = await normalizeVisualAsset({
      id: item.id,
      source: "inline",
      fileName: item.fileName,
      mimeType: "image/png",
      bytes,
      kind: cat,
      userMessage: item.prompt,
    });
    assert.ok(asset);
    const need = inferVisionNeed({
      userMessage: item.prompt,
      assetCount: 1,
      hasLowQualityHint: cat === "low_quality_scan",
    });
    assert.ok(need === "standard" || need === "complex");
  }

  const live = process.env.ADEHQ_VISION_BENCHMARK_LIVE === "1";
  const hasKey = Boolean(process.env.SILICONFLOW_API_KEY?.trim());
  mkdirSync(OUT, { recursive: true });

  type Row = {
    id: string;
    category: VisualAssetKind;
    latencyMs: number;
    costUsd: number;
    confidence: number;
    escalated: boolean;
    factHitRate: number;
    missedDetails: string[];
    hallucinationRisk: boolean;
    routeId: string;
    error?: string;
  };

  const rows: Row[] = [];

  if (live && hasKey) {
    console.log("Running LIVE vision benchmark (VL-8B → escalate when needed)…");
    for (const item of items) {
      const bytes = readFileSync(join(ROOT, item.fileName));
      const asset = (await normalizeVisualAsset({
        id: item.id,
        source: "inline",
        fileName: item.fileName,
        mimeType: "image/png",
        bytes,
        kind: item.category,
        userMessage: item.prompt,
      }))!;
      const need = inferVisionNeed({
        userMessage: item.prompt,
        assetCount: 1,
        hasLowQualityHint: item.category === "low_quality_scan",
      });
      try {
        const first = await callSiliconFlowVision({
          routeId: "route_vision_qwen3_vl_8b_sf",
          userMessage: item.prompt,
          assets: [asset],
        });
        const assessment = assessVisionConfidence({
          rawText: first.text,
          userMessage: item.prompt,
          need,
        });
        let text = extractUnderstandingText(first.text);
        let latencyMs = first.latencyMs;
        let inputTokens = first.inputTokens;
        let outputTokens = first.outputTokens;
        let routeId = first.routeId;
        let escalated = false;

        if (shouldEscalateFromStandard(assessment) || need === "complex") {
          const second = await callSiliconFlowVision({
            routeId: "route_vision_qwen3_vl_32b_sf",
            userMessage: item.prompt,
            assets: [asset],
          });
          text = extractUnderstandingText(second.text);
          latencyMs += second.latencyMs;
          inputTokens += second.inputTokens;
          outputTokens += second.outputTokens;
          routeId = second.routeId;
          escalated = true;
        }

        const snap8 = getLiveSeedSnapshot("route_vision_qwen3_vl_8b_sf")!;
        const snap32 = getLiveSeedSnapshot("route_vision_qwen3_vl_32b_sf")!;
        const costUsd =
          costUsdFromSnapshot(snap8, {
            inputTokens: escalated ? first.inputTokens : inputTokens,
            outputTokens: escalated ? first.outputTokens : outputTokens,
          }) +
          (escalated
            ? costUsdFromSnapshot(snap32, {
                inputTokens: inputTokens - first.inputTokens,
                outputTokens: outputTokens - first.outputTokens,
              })
            : 0);

        const scored = scoreFacts(text, item.expectedFacts);
        rows.push({
          id: item.id,
          category: item.category,
          latencyMs,
          costUsd,
          confidence: assessment.confidence,
          escalated,
          factHitRate: scored.hit / item.expectedFacts.length,
          missedDetails: scored.missed,
          hallucinationRisk: scored.hallucinationRisk,
          routeId,
        });
        console.log(
          `  ${item.id} hit=${scored.hit}/${item.expectedFacts.length} lat=${latencyMs}ms esc=${escalated}`,
        );
      } catch (error) {
        rows.push({
          id: item.id,
          category: item.category,
          latencyMs: 0,
          costUsd: 0,
          confidence: 0,
          escalated: false,
          factHitRate: 0,
          missedDetails: item.expectedFacts,
          hallucinationRisk: false,
          routeId: "route_vision_qwen3_vl_8b_sf",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    console.log(
      "Offline mode — fixture set + unit scaffolding only (set ADEHQ_VISION_BENCHMARK_LIVE=1 for VL scores).",
    );
    for (const item of items) {
      rows.push({
        id: item.id,
        category: item.category,
        latencyMs: 0,
        costUsd: 0,
        confidence: 0,
        escalated: false,
        factHitRate: 0,
        missedDetails: [],
        hallucinationRisk: false,
        routeId: "route_vision_qwen3_vl_8b_sf",
      });
    }
  }

  const byCategory = Object.fromEntries(
    CATEGORIES.map((cat) => {
      const subset = rows.filter((r) => r.category === cat);
      const n = subset.length || 1;
      return [
        cat,
        {
          count: subset.length,
          avgFactHitRate: subset.reduce((s, r) => s + r.factHitRate, 0) / n,
          avgLatencyMs: subset.reduce((s, r) => s + r.latencyMs, 0) / n,
          totalCostUsd: subset.reduce((s, r) => s + r.costUsd, 0),
          escalationRate: subset.filter((r) => r.escalated).length / n,
          hallucinationFlags: subset.filter((r) => r.hallucinationRisk).length,
          missedDetailCount: subset.reduce((s, r) => s + r.missedDetails.length, 0),
          errors: subset.filter((r) => r.error).length,
        },
      ];
    }),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    mode: live && hasKey ? "live" : "offline",
    fixtureCount: items.length,
    categories: CATEGORIES,
    byCategory,
    rows: live && hasKey ? rows : undefined,
  };
  const reportPath = join(OUT, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${reportPath}`);
  console.log("PASS  test-brain-vision-benchmark");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
