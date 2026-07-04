import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, planRoute } from "@/lib/ai/runtime";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { artifactWorkLogAction } from "@/lib/server/file-context";
import { artifactFromRow } from "@/lib/files/records";
import { syncArtifactToStorage } from "@/lib/drive/storage-sync";
import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import { nowISO, uid } from "@/lib/utils";
import type { BrowserResearchRun } from "./types";

export type CreateResearchReportArtifactParams = {
  client: SupabaseClient;
  run: Pick<
    BrowserResearchRun,
    | "id"
    | "workspaceId"
    | "roomId"
    | "topicId"
    | "employeeId"
    | "createdBy"
    | "query"
    | "findings"
    | "mockSources"
    | "workUnitId"
  >;
  evidenceIds?: string[];
  stagehandLlmProvider?: string;
  stagehandModelId?: string;
};

export type ResearchReportArtifactResult = {
  artifactId: string;
  reportCostUsd: number;
  reportWorkMinutes: number;
  usedRuntimeSynthesis: boolean;
};

function truncateQuery(query: string, max = 72): string {
  const trimmed = query.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function buildTemplateReportMarkdown(
  run: CreateResearchReportArtifactParams["run"],
  evidenceIds: string[],
): string {
  const lines: string[] = [
    `# Research report: ${truncateQuery(run.query)}`,
    "",
    "## Research question",
    run.query.trim(),
    "",
    "## Key findings",
  ];

  if (run.findings.length === 0) {
    lines.push("- No findings were recorded.");
  } else {
    for (const finding of run.findings) {
      lines.push(`- **${finding.title}** — ${finding.summary}`);
    }
  }

  lines.push("", "## Sources");
  for (const source of run.mockSources) {
    const evidenceNote =
      source.evidenceId && evidenceIds.includes(source.evidenceId)
        ? ` · screenshot evidence \`${source.evidenceId}\``
        : "";
    lines.push(`- [${source.title}](${source.url}) — ${source.note}${evidenceNote}`);
  }

  if (evidenceIds.length > 0) {
    lines.push("", "## Browser evidence");
    lines.push(
      `${evidenceIds.length} screenshot(s) captured during live browsing and saved to Drive evidence.`,
    );
  }

  lines.push("", "## Open questions", "- What should we validate next with primary sources?");
  return lines.join("\n");
}

async function synthesizeReportMarkdown(
  run: CreateResearchReportArtifactParams["run"],
): Promise<{ markdown?: string; costUsd: number; workMinutes: number }> {
  const flags = getRuntimeFlags();
  const forceMode = flags.mode === "on" ? undefined : ("shadow" as const);
  const prompt = [
    "Synthesize these browser research findings into a short report (markdown).",
    "Include: brief intro, key findings, source citations with URLs, open questions.",
    "",
    `Query: ${run.query}`,
    "",
    "Findings:",
    ...run.findings.map((f) => `- ${f.title}: ${f.summary}`),
    "",
    "Sources:",
    ...run.mockSources.map((s) => `- ${s.title} (${s.url}): ${s.note}`),
  ].join("\n");

  const fallbackPlan = planRoute({
    capability: "summarization",
    workspaceId: run.workspaceId,
    employeeId: run.employeeId,
    message: run.query,
  });

  try {
    const result = await generateText(
      {
        capability: "summarization",
        workspaceId: run.workspaceId,
        employeeId: run.employeeId,
        runtimeMode: "balanced",
        system:
          "You write concise research reports with citations. Use markdown. Do not invent URLs.",
        prompt,
        maxTokens: 1200,
      },
      { forceMode },
    );

    const costUsd =
      result.usage?.totalCostUsd ??
      result.routing?.estimatedCostUsd ??
      fallbackPlan.estimatedCostUsd;
    const workMinutes =
      result.workMinutesEstimated ??
      estimateWorkMinutesFromCost(costUsd) ??
      fallbackPlan.estimatedWorkMinutes;

    if (result.text?.trim() && !result.shadow) {
      return { markdown: result.text.trim(), costUsd, workMinutes };
    }

    return { costUsd, workMinutes };
  } catch (error) {
    console.warn("[AdeHQ browser research report]", error);
    return {
      costUsd: fallbackPlan.estimatedCostUsd,
      workMinutes: fallbackPlan.estimatedWorkMinutes,
    };
  }
}

/** Create a research_summary artifact + work log entry from a completed live run. */
export async function createResearchReportArtifactFromRun(
  params: CreateResearchReportArtifactParams,
): Promise<ResearchReportArtifactResult | null> {
  const { run, client } = params;
  if (!run.topicId || !run.roomId) return null;

  const evidenceIds = params.evidenceIds ?? [];
  const synthesis = await synthesizeReportMarkdown(run);
  const contentMarkdown =
    synthesis.markdown ?? buildTemplateReportMarkdown(run, evidenceIds);

  const sourceCitations = run.mockSources.map((source) => ({
    fileName: source.title,
    snippet: source.note,
    url: source.url,
    evidenceId: source.evidenceId ?? null,
  }));

  const artifactId = uid("art");
  const { data: artifactRow, error } = await client
    .from("artifacts")
    .insert({
      id: artifactId,
      workspace_id: run.workspaceId,
      room_id: run.roomId,
      topic_id: run.topicId,
      title: `Research: ${truncateQuery(run.query)}`,
      artifact_type: "research_summary",
      status: "saved",
      content_markdown: contentMarkdown,
      content_json: {
        browserResearchRunId: run.id,
        query: run.query,
        provider: "browserbase",
        mockSources: run.mockSources,
        findings: run.findings,
        evidenceIds,
        workUnitId: run.workUnitId,
        stagehandLlmProvider: params.stagehandLlmProvider,
        stagehandModelId: params.stagehandModelId,
      },
      created_by_type: "ai",
      created_by_id: run.employeeId,
      source_citations: sourceCitations,
    })
    .select("*")
    .single();
  if (error) throw error;

  const artifact = artifactFromRow(artifactRow as Record<string, unknown>);
  await syncArtifactToStorage(client, artifact, run.createdBy).catch((err) =>
    console.warn("[AdeHQ browser research report] storage sync failed", err),
  );

  await client.from("artifact_versions").insert({
    artifact_id: artifact.id,
    version_number: 1,
    content_markdown: artifact.contentMarkdown,
    content_json: artifact.contentJson,
    source_citations: artifact.sourceCitations,
    created_by_type: "ai",
    created_by_id: run.employeeId,
  });

  await client.from("work_log_events").insert({
    workspace_id: run.workspaceId,
    id: uid("log"),
    room_id: run.roomId,
    topic_id: run.topicId,
    employee_id: run.employeeId,
    action: artifactWorkLogAction("research_summary"),
    summary: `Generated research report: ${artifact.title}`,
    status: "success",
    related_entity_type: "artifact",
    related_entity_id: artifact.id,
    agent_run_id: run.workUnitId ?? null,
    created_at: nowISO(),
  });

  return {
    artifactId: artifact.id,
    reportCostUsd: synthesis.costUsd,
    reportWorkMinutes: synthesis.workMinutes,
    usedRuntimeSynthesis: Boolean(synthesis.markdown),
  };
}
