import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { getPlatformInsights } from "@/lib/admin/metrics/query";
import { parseMetricRange } from "@/lib/admin/metrics/query";
import { getOpenIncidentCount } from "@/lib/admin/queries/incidents";
import { getModelsSummary } from "@/lib/admin/queries/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CopilotAnswer = {
  summary: string;
  metrics: Record<string, number | string | null>;
  suggestions: string[];
};

function answerFromQuestion(
  question: string,
  insights: Awaited<ReturnType<typeof getPlatformInsights>>,
  openIncidents: number,
  providerHealth: Awaited<ReturnType<typeof getModelsSummary>>["providerHealth"],
): CopilotAnswer {
  const q = question.toLowerCase();
  const metrics: Record<string, number | string | null> = {
    signupsThisWeek: insights.overview.signups.week,
    activeWorkspaces: insights.overview.workspaces.activeInRange,
    aiCostUsd: insights.overview.usage.totalCostUsd,
    failedAiRuns: insights.overview.usage.failedCount,
    workHours: insights.overview.workHours.totalHours,
    openIncidents,
  };

  if (q.includes("cost") || q.includes("spend") || q.includes("usage")) {
    const top = insights.usageByProvider.breakdown?.[0];
    return {
      summary: `AI cost in range: $${insights.overview.usage.totalCostUsd.toFixed(2)} across ${insights.overview.usage.eventCount} events. ${insights.overview.usage.failedCount} failed runs.`,
      metrics,
      suggestions: [
        top ? `Top provider: ${top.key} ($${top.costUsd.toFixed(2)})` : "Check /admin/usage for provider breakdown",
        "Review high-cost workspaces on /admin/security",
      ],
    };
  }

  if (q.includes("growth") || q.includes("signup") || q.includes("activation")) {
    return {
      summary: `${insights.overview.signups.week} signups this week (${insights.overview.signups.today} today). Onboarding completion: ${(insights.growth.onboardingCompletionRate * 100).toFixed(1)}%.`,
      metrics,
      suggestions: ["See /admin/growth for funnel details", "Check workspace activation in growth dashboard"],
    };
  }

  if (q.includes("incident") || q.includes("outage") || q.includes("health")) {
    const degraded = providerHealth.filter((p) => p.status === "degraded");
    return {
      summary: `${openIncidents} open incident(s). ${degraded.length} provider(s) degraded.`,
      metrics,
      suggestions: [
        "Open /admin/incidents for incident command",
        "Check /admin/system-health for rollup",
      ],
    };
  }

  if (q.includes("work hour") || q.includes("work-hour")) {
    const commercialHrs = insights.workHours.commercial?.totalWorkHours ?? 0;
    const shadowHrs =
      insights.workHours.shadow?.workHours ?? insights.workHours.totals?.workHours ?? 0;
    const shadowMins =
      insights.workHours.shadow?.workMinutes ?? insights.workHours.totals?.workMinutes ?? 0;
    return {
      summary: `${commercialHrs.toFixed(1)} billable commercial WH in range; ${shadowHrs.toFixed(1)} shadow WH (${shadowMins.toFixed(0)} minutes, measurement-only).`,
      metrics,
      suggestions: ["See /admin/work-hours for 168h usage clock and shadow calibration"],
    };
  }

  return {
    summary: `Platform snapshot: ${insights.overview.signups.week} signups this week, ${insights.overview.workspaces.activeInRange} active workspaces, $${insights.overview.usage.totalCostUsd.toFixed(2)} AI cost.`,
    metrics,
    suggestions: [
      "Ask about cost, growth, incidents, or work hours",
      "Use specific dashboards for drill-down",
    ],
  };
}

export const POST = adminRoute(async (request, { serviceClient }) => {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const range = parseMetricRange(typeof body?.range === "string" ? body.range : "7d");

  if (!question) {
    return NextResponse.json({ error: "question is required." }, { status: 400 });
  }

  const [insights, openIncidents, models] = await Promise.all([
    getPlatformInsights(serviceClient, range),
    getOpenIncidentCount(serviceClient),
    getModelsSummary(serviceClient),
  ]);

  const answer = answerFromQuestion(question, insights, openIncidents, models.providerHealth);

  return NextResponse.json({
    question,
    range,
    answer,
    insights: {
      overview: insights.overview,
      growth: insights.growth,
      usageTopProviders: insights.usageByProvider.breakdown?.slice(0, 5) ?? [],
    },
  });
});
