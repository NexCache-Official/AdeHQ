// One cheap-LLM narration pass over a completed simulation report — turns
// the deterministic findings into a short, plain-language summary Maya can
// say out loud. Always falls back to a deterministic templated summary on
// any failure/timeout/missing config; never blocks approval.

import { generateText } from "ai";
import { resolveModel } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import type { SimulationReport } from "./types";

const TIMEOUT_MS = 4000;

function deterministicNarration(report: SimulationReport): string {
  const critical = report.findings.filter((f) => f.severity === "critical").length;
  const warnings = report.findings.filter((f) => f.severity === "warning").length;
  if (critical > 0) {
    return `This plan has ${critical} critical issue${critical === 1 ? "" : "s"} to fix before it's ready — see the findings below.`;
  }
  if (warnings > 0) {
    return `This plan looks workable with ${warnings} warning${warnings === 1 ? "" : "s"} worth reviewing — expected weekly Work Hours: ~${report.totalExpectedWeeklyWh}.`;
  }
  return `This plan looks ready — no coverage or permission gaps found, and expected weekly Work Hours are ~${report.totalExpectedWeeklyWh}.`;
}

export async function narrateSimulation(report: SimulationReport): Promise<string> {
  const fallback = deterministicNarration(report);
  if (!isSiliconFlowConfigured()) return fallback;
  if (report.findings.length === 0) return fallback;

  try {
    const modelId = resolveModel("siliconflow", "cheap");
    const textPromise = generateText({
      model: siliconFlowChatModel(modelId),
      system:
        "You are Maya, AdeHQ's AI Workforce Manager. Summarize a team-design simulation result in 1-2 short sentences, plain language, no bullet points. Mention the most important issue by name if there's a critical one.",
      prompt: [
        `Passed: ${report.passed}`,
        `Total expected weekly Work Hours: ${report.totalExpectedWeeklyWh}`,
        `Findings (${report.findings.length}): ${report.findings
          .slice(0, 6)
          .map((f) => `[${f.severity}] ${f.message}`)
          .join(" | ")}`,
      ].join("\n"),
      maxOutputTokens: 140,
      providerOptions: siliconFlowProviderOptions(modelId),
    });
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const result = await Promise.race([textPromise, timeoutPromise]);
    const text = result?.text?.trim();
    return text || fallback;
  } catch (error) {
    console.warn("[AdeHQ workforce-studio] simulation narration skipped", error);
    return fallback;
  }
}
