import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharedFinding, SharedFindingVisibility } from "./types-execution";

function newFindingId(): string {
  return `find_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Strip patterns that look like private DM transcript leakage. */
function sanitizeFindingSummary(summary: string): string {
  return summary
    .replace(/\bprivate dm\b/gi, "[redacted]")
    .replace(/\bdm with\b/gi, "conversation with")
    .trim()
    .slice(0, 4000);
}

/**
 * Publish a structured finding for the lead / room. Never stores private DM context.
 */
export async function publishSharedFinding(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    brainRunId: string;
    brainStepId?: string | null;
    producedByEmployeeId: string;
    title: string;
    summary: string;
    evidenceSourceIds?: string[];
    artifactIds?: string[];
    confidence?: number;
    visibility?: SharedFindingVisibility;
    /** Hard reject if caller marks private DM context. */
    containsPrivateDmContext?: boolean;
    /** Optional PR-25 playbook / artifact correlation (additive). */
    playbookRunId?: string | null;
    playbookRunStepId?: string | null;
    artifactId?: string | null;
    artifactSectionKey?: string | null;
    findingType?: string | null;
    sourceRefs?: Array<Record<string, unknown>>;
  },
): Promise<SharedFinding | null> {
  if (input.containsPrivateDmContext) {
    console.warn("[AdeHQ steward] refused finding with private DM context");
    return null;
  }

  const id = newFindingId();
  const finding: SharedFinding = {
    id,
    brainRunId: input.brainRunId,
    brainStepId: input.brainStepId ?? undefined,
    producedByEmployeeId: input.producedByEmployeeId,
    title: input.title.trim().slice(0, 200) || "Finding",
    summary: sanitizeFindingSummary(input.summary),
    evidenceSourceIds: input.evidenceSourceIds ?? [],
    artifactIds: input.artifactIds ?? [],
    confidence: Math.min(1, Math.max(0, input.confidence ?? 0.7)),
    visibility: input.visibility ?? "lead_only",
    containsPrivateDmContext: false,
  };

  const row: Record<string, unknown> = {
    id: finding.id,
    workspace_id: input.workspaceId,
    brain_run_id: finding.brainRunId,
    brain_step_id: finding.brainStepId ?? null,
    produced_by_employee_id: finding.producedByEmployeeId,
    title: finding.title,
    summary: finding.summary,
    evidence_source_ids: finding.evidenceSourceIds,
    artifact_ids: finding.artifactIds,
    confidence: finding.confidence,
    visibility: finding.visibility,
    contains_private_dm_context: false,
  };

  if (input.playbookRunId !== undefined) row.playbook_run_id = input.playbookRunId;
  if (input.playbookRunStepId !== undefined) {
    row.playbook_run_step_id = input.playbookRunStepId;
  }
  if (input.artifactId !== undefined) row.artifact_id = input.artifactId;
  if (input.artifactSectionKey !== undefined) {
    row.artifact_section_key = input.artifactSectionKey;
  }
  if (input.findingType !== undefined) row.finding_type = input.findingType;
  if (input.sourceRefs !== undefined) row.source_refs = input.sourceRefs;

  const { error } = await client.from("brain_shared_findings").insert(row);
  if (error) throw error;
  return finding;
}

export async function listFindingsForRun(
  client: SupabaseClient,
  workspaceId: string,
  brainRunId: string,
): Promise<SharedFinding[]> {
  const { data, error } = await client
    .from("brain_shared_findings")
    .select(
      "id, brain_run_id, brain_step_id, produced_by_employee_id, title, summary, evidence_source_ids, artifact_ids, confidence, visibility, contains_private_dm_context",
    )
    .eq("workspace_id", workspaceId)
    .eq("brain_run_id", brainRunId)
    .eq("contains_private_dm_context", false)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: String(row.id),
    brainRunId: String(row.brain_run_id),
    brainStepId: row.brain_step_id ? String(row.brain_step_id) : undefined,
    producedByEmployeeId: String(row.produced_by_employee_id),
    title: String(row.title),
    summary: String(row.summary),
    evidenceSourceIds: Array.isArray(row.evidence_source_ids)
      ? (row.evidence_source_ids as string[])
      : [],
    artifactIds: Array.isArray(row.artifact_ids) ? (row.artifact_ids as string[]) : [],
    confidence: Number(row.confidence ?? 0.7),
    visibility: (row.visibility as SharedFindingVisibility) ?? "lead_only",
    containsPrivateDmContext: false as const,
  }));
}

/** Compact board text for lead synthesis prompt injection. */
export function formatFindingsBoard(findings: SharedFinding[]): string {
  if (!findings.length) return "";
  const lines = findings.map(
    (f, i) =>
      `${i + 1}. [${f.title}] (by ${f.producedByEmployeeId}, confidence ${f.confidence.toFixed(2)})\n${f.summary}`,
  );
  return [
    "Shared findings from collaborators (use these; do not invent private DM content):",
    ...lines,
  ].join("\n\n");
}
