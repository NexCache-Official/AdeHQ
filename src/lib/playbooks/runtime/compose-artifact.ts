import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { PlaybookArtifactIntent, PlaybookStepDefinition } from "@/lib/playbooks/contracts";
import type { DocumentArtifactV1 } from "@/lib/artifacts/contracts/document";
import type { PresentationArtifactV1 } from "@/lib/artifacts/contracts/presentation";
import type { WorkbookArtifactV1 } from "@/lib/artifacts/contracts/workbook";
import { stableChecksum } from "@/lib/playbooks/checksum";

export type ComposeArtifactInput = {
  workspaceId: string;
  playbookRunId: string;
  brainRunId: string | null;
  roomId?: string | null;
  topicId?: string | null;
  employeeId?: string | null;
  step: PlaybookStepDefinition;
  runInput: Record<string, unknown>;
  stepInputs: Record<string, unknown>;
  stepOutputs: Record<string, unknown>;
};

export type ComposeArtifactResult = {
  artifactId: string;
  versionId: string;
  kind: string;
  title: string;
  canonical: Record<string, unknown>;
  contentMarkdown: string;
};

function resolveTitle(input: ComposeArtifactInput): string {
  const fromInput =
    (typeof input.runInput.title === "string" && input.runInput.title.trim()) ||
    (typeof input.runInput.topic === "string" && input.runInput.topic.trim()) ||
    (typeof input.runInput.company === "string" && input.runInput.company.trim()) ||
    (typeof input.stepInputs.title === "string" && String(input.stepInputs.title).trim()) ||
    "";
  if (fromInput) return fromInput.slice(0, 200);
  return input.step.objective.slice(0, 200) || "Playbook artifact";
}

function resolveKind(intent?: PlaybookArtifactIntent): string {
  const raw = String(intent?.kind ?? "document").toLowerCase();
  if (raw === "presentation" || raw === "slides" || raw === "deck") return "presentation";
  if (raw === "workbook" || raw === "spreadsheet" || raw === "dataset") return "workbook";
  if (raw === "report" || raw === "checklist") return raw;
  return "document";
}

function artifactTypeForKind(kind: string): string {
  if (kind === "presentation") return "presentation";
  if (kind === "workbook" || kind === "dataset") return "workbook";
  if (kind === "checklist") return "checklist";
  if (kind === "report") return "report";
  return "document";
}

function summaryFromContext(input: ComposeArtifactInput): string {
  const bits: string[] = [];
  if (typeof input.runInput.topic === "string") bits.push(String(input.runInput.topic));
  if (typeof input.runInput.brief === "string") bits.push(String(input.runInput.brief).slice(0, 400));
  if (typeof input.stepOutputs.summary === "string") bits.push(String(input.stepOutputs.summary));
  bits.push(input.step.objective);
  return bits.filter(Boolean).join(" — ").slice(0, 800);
}

function buildDocument(
  title: string,
  summary: string,
  intent: PlaybookArtifactIntent | undefined,
  input: ComposeArtifactInput,
): DocumentArtifactV1 {
  const sectionKeys =
    intent?.sectionKeys?.length ? intent.sectionKeys : ["summary", "findings", "recommendations"];
  const sections = sectionKeys.map((key) => {
    const prior =
      (input.stepOutputs[key] as unknown) ??
      (input.stepInputs[key] as unknown) ??
      null;
    const text =
      typeof prior === "string"
        ? prior
        : prior && typeof prior === "object"
          ? JSON.stringify(prior).slice(0, 1200)
          : summary;
    return {
      key,
      title: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      blocks: [{ type: "paragraph" as const, text: text || `${title}: ${key}` }],
    };
  });

  return {
    schemaKey: "adehq.document.v1",
    schemaVersion: 1,
    kind: intent?.kind === "checklist" ? "checklist" : intent?.kind === "report" ? "report" : "document",
    title,
    summary,
    sections,
    metadata: {
      playbookStepKey: input.step.stepKey,
      objective: input.step.objective,
    },
  };
}

function buildPresentation(
  title: string,
  summary: string,
  input: ComposeArtifactInput,
): PresentationArtifactV1 {
  const sectionKeys = input.step.artifactIntent?.sectionKeys ?? ["agenda", "insights", "next_steps"];
  const slides = [
    {
      key: "title",
      layout: "title" as const,
      title,
      subtitle: summary.slice(0, 200),
    },
    ...sectionKeys.map((key) => ({
      key,
      layout: "bullets" as const,
      title: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      bullets: [
        input.step.objective,
        typeof input.runInput.topic === "string" ? String(input.runInput.topic) : "Key takeaway",
      ].filter(Boolean),
    })),
  ];

  return {
    schemaKey: "adehq.presentation.v1",
    schemaVersion: 1,
    kind: "presentation",
    title,
    subtitle: summary.slice(0, 200),
    slides,
    metadata: {
      playbookStepKey: input.step.stepKey,
    },
  };
}

function buildWorkbook(title: string, input: ComposeArtifactInput): WorkbookArtifactV1 {
  const rows: Array<Array<string | number | null>> = [
    ["Item", "Value"],
    ["Objective", input.step.objective],
    ["Topic", typeof input.runInput.topic === "string" ? String(input.runInput.topic) : ""],
    ["Generated", new Date().toISOString()],
  ];
  return {
    schemaKey: "adehq.workbook.v1",
    schemaVersion: 1,
    kind: "workbook",
    title,
    sheets: [
      {
        name: "Summary",
        columns: ["Item", "Value"],
        rows,
      },
    ],
    metadata: {
      playbookStepKey: input.step.stepKey,
    },
  };
}

/** Generate simple markdown from canonical structured content. */
export function canonicalToMarkdown(canonical: Record<string, unknown>): string {
  const title = String(canonical.title ?? "Untitled");
  const lines: string[] = [`# ${title}`, ""];

  if (typeof canonical.summary === "string" && canonical.summary.trim()) {
    lines.push(canonical.summary.trim(), "");
  }

  if (Array.isArray(canonical.sections)) {
    for (const section of canonical.sections as Array<Record<string, unknown>>) {
      lines.push(`## ${String(section.title ?? section.key ?? "Section")}`, "");
      const blocks = Array.isArray(section.blocks) ? section.blocks : [];
      for (const block of blocks as Array<Record<string, unknown>>) {
        if (block.type === "heading") lines.push(`${"#".repeat(Number(block.level) || 2)} ${block.text}`, "");
        else if (block.type === "paragraph" || block.type === "callout" || block.type === "quote") {
          lines.push(String(block.text ?? ""), "");
        } else if (block.type === "bullets" || block.type === "numbered") {
          const items = Array.isArray(block.items) ? block.items : [];
          items.forEach((item, i) => {
            lines.push(block.type === "numbered" ? `${i + 1}. ${item}` : `- ${item}`);
          });
          lines.push("");
        }
      }
    }
  }

  if (Array.isArray(canonical.slides)) {
    for (const slide of canonical.slides as Array<Record<string, unknown>>) {
      lines.push(`## ${String(slide.title ?? "Slide")}`, "");
      if (typeof slide.subtitle === "string") lines.push(slide.subtitle, "");
      const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
      for (const b of bullets) lines.push(`- ${b}`);
      if (bullets.length) lines.push("");
    }
  }

  if (Array.isArray(canonical.sheets)) {
    for (const sheet of canonical.sheets as Array<Record<string, unknown>>) {
      lines.push(`## ${String(sheet.name ?? "Sheet")}`, "");
      const columns = Array.isArray(sheet.columns) ? sheet.columns.map(String) : [];
      if (columns.length) lines.push(`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`);
      const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
      for (const row of rows as unknown[]) {
        if (!Array.isArray(row)) continue;
        lines.push(`| ${row.map((c) => String(c ?? "")).join(" | ")} |`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

export function buildCanonicalForStep(input: ComposeArtifactInput): {
  kind: string;
  canonical: Record<string, unknown>;
  contentMarkdown: string;
  title: string;
  schemaKey: string;
  schemaVersion: number;
} {
  const title = resolveTitle(input);
  const summary = summaryFromContext(input);
  const kind = resolveKind(input.step.artifactIntent);

  let canonical: Record<string, unknown>;
  if (kind === "presentation") {
    canonical = buildPresentation(title, summary, input) as unknown as Record<string, unknown>;
  } else if (kind === "workbook" || kind === "dataset") {
    canonical = buildWorkbook(title, input) as unknown as Record<string, unknown>;
  } else {
    canonical = buildDocument(title, summary, input.step.artifactIntent, input) as unknown as Record<
      string,
      unknown
    >;
  }

  return {
    kind,
    canonical,
    contentMarkdown: canonicalToMarkdown(canonical),
    title,
    schemaKey: String(canonical.schemaKey ?? input.step.artifactIntent?.schemaKey ?? "adehq.document.v1"),
    schemaVersion: Number(canonical.schemaVersion ?? input.step.artifactIntent?.schemaVersion ?? 1),
  };
}

/**
 * Create artifact + version from playbook step intent.
 * Uses service-capable client for writes; provenance columns live on artifact_versions.
 */
export async function composePlaybookArtifact(
  client: SupabaseClient,
  input: ComposeArtifactInput,
): Promise<ComposeArtifactResult> {
  const built = buildCanonicalForStep(input);
  const artifactId = randomUUID();
  const versionId = randomUUID();
  const artifactType = artifactTypeForKind(built.kind);
  const contentHash = stableChecksum(built.canonical);

  const { error: artErr } = await client.from("artifacts").insert({
    id: artifactId,
    workspace_id: input.workspaceId,
    room_id: input.roomId ?? null,
    topic_id: input.topicId ?? null,
    title: built.title,
    artifact_type: artifactType,
    kind: built.kind === "dataset" ? "dataset" : built.kind === "report" ? "report" : built.kind === "checklist" ? "checklist" : built.kind,
    status: "draft",
    content_markdown: built.contentMarkdown,
    content_json: built.canonical,
    created_by_type: input.employeeId ? "ai" : "system",
    created_by_id: input.employeeId ?? "playbook-runtime",
    source_file_ids: [],
    source_message_ids: [],
    source_chunk_ids: [],
    source_citations: [],
    metadata: {
      origin: "playbook",
      playbookRunId: input.playbookRunId,
      brainRunId: input.brainRunId,
      stepKey: input.step.stepKey,
    },
  });
  if (artErr) throw artErr;

  const { error: verErr } = await client.from("artifact_versions").insert({
    id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    content_markdown: built.contentMarkdown,
    content_json: built.canonical,
    canonical_content: built.canonical,
    content_hash: contentHash,
    schema_key: built.schemaKey,
    schema_version: built.schemaVersion,
    status: "draft",
    origin: "playbook",
    playbook_run_id: input.playbookRunId,
    brain_run_id: input.brainRunId,
    created_by_type: input.employeeId ? "ai" : "system",
    created_by_id: input.employeeId ?? "playbook-runtime",
    source_citations: [],
  });
  if (verErr) throw verErr;

  await client
    .from("artifacts")
    .update({ current_version_id: versionId })
    .eq("id", artifactId);

  return {
    artifactId,
    versionId,
    kind: built.kind,
    title: built.title,
    canonical: built.canonical,
    contentMarkdown: built.contentMarkdown,
  };
}
