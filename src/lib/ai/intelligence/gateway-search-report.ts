import type { SupabaseClient } from "@supabase/supabase-js";
import { artifactFromRow } from "@/lib/files/records";
import { syncArtifactToStorage } from "@/lib/drive/storage-sync";
import { artifactWorkLogAction } from "@/lib/server/file-context";
import type { MessageArtifact } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";

export type GatewaySearchReportInput = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  employeeId: string;
  createdBy: string;
  query: string;
  answer: string;
  sourcesArtifact?: MessageArtifact;
  agentRunId?: string;
  provider?: string;
};

export type GatewaySearchReportResult = {
  artifactId: string;
  messageArtifact: MessageArtifact;
};

function truncateQuery(query: string, max = 72): string {
  const trimmed = query.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function buildReportMarkdown(input: GatewaySearchReportInput): string {
  const lines = [
    `# Research report: ${truncateQuery(input.query)}`,
    "",
    "## Research question",
    input.query.trim(),
    "",
    "## Summary",
    input.answer.trim(),
    "",
    "## Sources",
  ];

  const webSources = input.sourcesArtifact?.meta?.webSources as
    | Array<{ title?: string; url?: string; domain?: string }>
    | undefined;
  if (webSources?.length) {
    for (const source of webSources) {
      const title = source.title?.trim() || source.domain || "Source";
      const url = source.url?.trim();
      lines.push(url ? `- [${title}](${url})` : `- ${title}`);
    }
  } else {
    lines.push("- Sources captured in the chat message.");
  }

  lines.push("", "_Generated from a fast web search (L2 research)._");
  return lines.join("\n");
}

/** L2 research report — structured artifact from gateway search (not live browser). */
export async function createGatewaySearchResearchReport(
  client: SupabaseClient,
  input: GatewaySearchReportInput,
): Promise<GatewaySearchReportResult | null> {
  if (!input.topicId || !input.roomId || !input.answer.trim()) return null;

  const contentMarkdown = buildReportMarkdown(input);
  const webSources = input.sourcesArtifact?.meta?.webSources as
    | Array<{ title?: string; url?: string; snippet?: string }>
    | undefined;
  const sourceCitations =
    webSources?.map((source) => ({
      fileName: source.title ?? "Web source",
      snippet: source.snippet ?? "",
      url: source.url ?? null,
    })) ?? [];

  const artifactId = uid("art");
  const { data: artifactRow, error } = await client
    .from("artifacts")
    .insert({
      id: artifactId,
      workspace_id: input.workspaceId,
      room_id: input.roomId,
      topic_id: input.topicId,
      title: `Research: ${truncateQuery(input.query)}`,
      artifact_type: "research_summary",
      status: "saved",
      content_markdown: contentMarkdown,
      content_json: {
        query: input.query,
        provider: input.provider ?? "gateway_search",
        researchLevel: 2,
        sourceAgentRunId: input.agentRunId ?? null,
        generatedFrom: "gateway_search",
      },
      created_by_type: "ai",
      created_by_id: input.employeeId,
      source_citations: sourceCitations,
    })
    .select("*")
    .single();
  if (error) {
    console.warn("[AdeHQ gateway search report] artifact insert failed", error.message);
    return null;
  }

  const artifact = artifactFromRow(artifactRow as Record<string, unknown>);
  await syncArtifactToStorage(client, artifact, input.createdBy).catch((err) =>
    console.warn("[AdeHQ gateway search report] storage sync failed", err),
  );

  await client.from("artifact_versions").insert({
    artifact_id: artifact.id,
    version_number: 1,
    content_markdown: artifact.contentMarkdown,
    content_json: artifact.contentJson,
    source_citations: artifact.sourceCitations,
    created_by_type: "ai",
    created_by_id: input.employeeId,
  });

  await client.from("work_log_events").insert({
    workspace_id: input.workspaceId,
    id: uid("log"),
    room_id: input.roomId,
    topic_id: input.topicId,
    employee_id: input.employeeId,
    action: artifactWorkLogAction("research_summary"),
    summary: `Generated research report: ${artifact.title}`,
    status: "success",
    related_entity_type: "artifact",
    related_entity_id: artifact.id,
    agent_run_id: input.agentRunId ?? null,
    created_at: nowISO(),
  });

  return {
    artifactId: artifact.id,
    messageArtifact: {
      type: "artifact",
      id: artifact.id,
      label: artifact.title,
      meta: {
        artifactType: "research_summary",
        artifactStatus: "saved",
      },
    },
  };
}

export async function attachArtifactToMessage(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    messageId: string;
    artifact: MessageArtifact;
  },
): Promise<MessageArtifact[]> {
  const { data: existing, error: readError } = await client
    .from("messages")
    .select("artifacts")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.messageId)
    .maybeSingle();
  if (readError) throw readError;

  const current = Array.isArray(existing?.artifacts)
    ? (existing.artifacts as MessageArtifact[])
    : [];
  const next = [...current, params.artifact];
  const { error: updateError } = await client
    .from("messages")
    .update({ artifacts: next })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.messageId);
  if (updateError) throw updateError;
  return next;
}
