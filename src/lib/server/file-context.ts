import type { SupabaseClient } from "@supabase/supabase-js";
import type { FileChunk, SavedArtifactType, WorkspaceFile } from "@/lib/types";
import { detectUserArtifactIntent } from "@/lib/artifacts/intelligence";
import { fileChunkFromRow, workspaceFileFromRow } from "@/lib/files/records";

type DbRow = Record<string, unknown>;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "is", "are", "was", "were", "be", "been", "this", "that", "these", "those", "it",
  "from", "by", "as", "about", "what", "does", "say", "tell", "me", "please", "can",
  "you", "summarize", "summary", "review", "explain",
]);

export type RetrievedFileChunk = {
  chunk: FileChunk;
  file: WorkspaceFile;
  score: number;
};

export type FileContextBundle = {
  chunks: RetrievedFileChunk[];
  files: WorkspaceFile[];
  chunkIds: Set<string>;
  fileIds: Set<string>;
};

export type FileCitation = {
  fileId: string;
  chunkId: string;
  label: string;
  quote?: string;
  fileName?: string;
  locator?: string;
};

export type ArtifactIntent = {
  type: SavedArtifactType;
  instruction?: string;
};

const SLASH_ARTIFACT_MAP: Record<string, SavedArtifactType> = {
  prd: "prd",
  report: "report",
  brief: "brief",
  proposal: "proposal",
  checklist: "checklist",
};

const NATURAL_ARTIFACT_PATTERNS: Array<{ pattern: RegExp; type: SavedArtifactType }> = [
  { pattern: /\bturn (?:this )?into (?:a )?prd\b/i, type: "prd" },
  { pattern: /\bgenerate (?:a )?prd\b/i, type: "prd" },
  { pattern: /\bwrite (?:a )?prd\b/i, type: "prd" },
  { pattern: /\bturn (?:this )?into (?:a )?report\b/i, type: "report" },
  { pattern: /\bgenerate (?:a )?(?:full )?report\b/i, type: "report" },
  { pattern: /\bturn (?:this )?into (?:a )?brief\b/i, type: "brief" },
  { pattern: /\bgenerate (?:a )?brief\b/i, type: "brief" },
  { pattern: /\bturn (?:this )?into (?:a )?proposal\b/i, type: "proposal" },
  { pattern: /\bgenerate (?:a )?proposal\b/i, type: "proposal" },
  { pattern: /\bturn (?:this )?into (?:a )?checklist\b/i, type: "checklist" },
  { pattern: /\bgenerate (?:a )?checklist\b/i, type: "checklist" },
  { pattern: /\bcreate (?:a )?research summary\b/i, type: "research_summary" },
  { pattern: /\bstrategy memo\b/i, type: "strategy_memo" },
  { pattern: /\bmeeting notes\b/i, type: "meeting_notes" },
];

export function detectArtifactIntent(message: string): ArtifactIntent | null {
  const trimmed = message.trim();
  const userIntent = detectUserArtifactIntent(trimmed);
  if (userIntent) return { type: userIntent };

  const lower = trimmed.toLowerCase();

  const slash = lower.match(/^\/(prd|report|brief|proposal|checklist)\b/);
  if (slash) {
    const type = SLASH_ARTIFACT_MAP[slash[1]];
    const instruction = trimmed.replace(/^\/\S+\s*/, "").trim() || undefined;
    return { type, instruction };
  }

  for (const item of NATURAL_ARTIFACT_PATTERNS) {
    if (item.pattern.test(trimmed)) {
      return { type: item.type };
    }
  }

  return null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

export function formatChunkLocator(chunk: FileChunk, file: WorkspaceFile): string {
  if (chunk.sheetName) {
    const rowPart =
      chunk.rowStart != null
        ? chunk.rowEnd != null && chunk.rowEnd !== chunk.rowStart
          ? `rows ${chunk.rowStart}–${chunk.rowEnd}`
          : `row ${chunk.rowStart}`
        : "";
    return rowPart ? `${chunk.sheetName} · ${rowPart}` : chunk.sheetName;
  }
  if (chunk.pageStart != null) {
    return chunk.pageEnd != null && chunk.pageEnd !== chunk.pageStart
      ? `p. ${chunk.pageStart}–${chunk.pageEnd}`
      : `p. ${chunk.pageStart}`;
  }
  return file.extension ? file.extension.toUpperCase() : "section";
}

export function formatCitationLabel(chunk: FileChunk, file: WorkspaceFile): string {
  const locator = formatChunkLocator(chunk, file);
  return `${file.displayName} · ${locator}`;
}

function scoreChunk(
  chunk: FileChunk,
  file: WorkspaceFile,
  keywords: string[],
  priorityFileIds: Set<string>,
  fileAgeMs: number,
): number {
  let score = 0;
  const fileName = file.displayName.toLowerCase();
  const content = chunk.content.toLowerCase();
  const header = chunk.content.slice(0, 120).toLowerCase();

  if (priorityFileIds.has(file.id)) score += 25;

  for (const keyword of keywords) {
    if (fileName.includes(keyword)) score += 12;
    if (header.includes(keyword)) score += 4;
    const matches = content.split(keyword).length - 1;
    score += Math.min(matches * 2, 10);
  }

  if (!keywords.length && priorityFileIds.has(file.id)) score += 8;

  // Slight recency boost (max ~5 points for files uploaded in last 7 days)
  const recencyBoost = Math.max(0, 5 - fileAgeMs / (7 * 24 * 60 * 60 * 1000) * 5);
  score += recencyBoost;

  return score;
}

export async function retrieveFileContext(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
  options: {
    userMessage: string;
    priorityFileIds?: string[];
    maxChunks?: number;
  },
): Promise<FileContextBundle> {
  const priorityFileIds = new Set(options.priorityFileIds ?? []);
  const maxChunks = options.maxChunks ?? 8;
  const keywords = tokenize(options.userMessage);
  const now = Date.now();

  let filesQuery = client
    .from("workspace_files")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .in("status", ["ready", "uploaded"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (priorityFileIds.size) {
    filesQuery = filesQuery.in("id", [...priorityFileIds]);
  }

  const { data: fileRows, error: fileError } = await filesQuery;
  if (fileError) throw fileError;

  let files = ((fileRows ?? []) as DbRow[]).map(workspaceFileFromRow);
  if (!files.length && priorityFileIds.size) {
    const { data: fallbackRows, error: fallbackError } = await client
      .from("workspace_files")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("topic_id", topicId)
      .in("status", ["ready", "uploaded"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (fallbackError) throw fallbackError;
    files = ((fallbackRows ?? []) as DbRow[]).map(workspaceFileFromRow);
  }

  if (!files.length) {
    return { chunks: [], files: [], chunkIds: new Set(), fileIds: new Set() };
  }

  const fileMap = new Map(files.map((f) => [f.id, f]));
  const { data: chunkRows, error: chunkError } = await client
    .from("file_chunks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in(
      "file_id",
      files.map((f) => f.id),
    )
    .order("chunk_index", { ascending: true });
  if (chunkError) throw chunkError;

  const scored: RetrievedFileChunk[] = ((chunkRows ?? []) as DbRow[])
    .map((row) => {
      const chunk = fileChunkFromRow(row);
      const file = fileMap.get(chunk.fileId);
      if (!file) return null;
      const ageMs = now - new Date(file.createdAt).getTime();
      return {
        chunk,
        file,
        score: scoreChunk(chunk, file, keywords, priorityFileIds, ageMs),
      };
    })
    .filter((item): item is RetrievedFileChunk => item !== null)
    .sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

  const selected =
    priorityFileIds.size && !keywords.length
      ? scored.slice(0, maxChunks)
      : scored.filter((item) => item.score > 0).slice(0, maxChunks).length
        ? scored.filter((item) => item.score > 0).slice(0, maxChunks)
        : scored.slice(0, maxChunks);

  const chunkIds = new Set(selected.map((item) => item.chunk.id));
  const fileIds = new Set(selected.map((item) => item.file.id));

  return {
    chunks: selected,
    files: files.filter((f) => fileIds.has(f.id)),
    chunkIds,
    fileIds,
  };
}

export function buildFileContextPrompt(bundle: FileContextBundle): string {
  if (!bundle.chunks.length) return "";

  const lines: string[] = [
    "File context (cite with [[source:fileName|locator|short snippet]] and effects.citations):",
  ];

  let totalChars = 0;
  const maxTotal = 6000;

  for (const { chunk, file } of bundle.chunks) {
    const locator = formatChunkLocator(chunk, file);
    const preview = chunk.content.slice(0, 900).trim();
    const block = [
      `[source:fileId=${file.id}, chunkId=${chunk.id}, fileName="${file.displayName}", locator="${locator}"]`,
      preview,
    ].join("\n");

    if (totalChars + block.length > maxTotal) break;
    lines.push(block);
    totalChars += block.length;
  }

  return lines.join("\n\n");
}

export function validateCitations(
  citations: FileCitation[],
  bundle: FileContextBundle,
): FileCitation[] {
  const valid: FileCitation[] = [];
  for (const citation of citations) {
    if (!bundle.chunkIds.has(citation.chunkId)) continue;
    if (!bundle.fileIds.has(citation.fileId)) continue;
    const match = bundle.chunks.find(
      (item) => item.chunk.id === citation.chunkId && item.file.id === citation.fileId,
    );
    if (!match) continue;
    valid.push({
      ...citation,
      fileName: match.file.displayName,
      locator: formatChunkLocator(match.chunk, match.file),
      label: citation.label?.trim() || formatCitationLabel(match.chunk, match.file),
    });
  }
  return valid;
}

export async function loadAttachmentFileIds(
  client: SupabaseClient,
  workspaceId: string,
  messageId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("message_attachments")
    .select("file_id")
    .eq("workspace_id", workspaceId)
    .eq("message_id", messageId)
    .eq("attachment_type", "file");
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => String(row.file_id)).filter(Boolean))];
}

export async function insertWorkGraphEdge(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    fromObjectType: string;
    fromObjectId: string;
    relationType: string;
    toObjectType: string;
    toObjectId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await client.from("work_graph_edges").insert({
    workspace_id: params.workspaceId,
    from_object_type: params.fromObjectType,
    from_object_id: params.fromObjectId,
    relation_type: params.relationType,
    to_object_type: params.toObjectType,
    to_object_id: params.toObjectId,
    metadata: params.metadata ?? {},
  });
}

export function artifactWorkLogAction(type: SavedArtifactType): string {
  switch (type) {
    case "prd":
      return "created_prd";
    case "report":
      return "created_report";
    case "brief":
      return "created_brief";
    case "proposal":
      return "created_artifact";
    case "checklist":
      return "created_artifact";
    case "email_draft":
      return "created_email_draft";
    case "research_summary":
      return "generated_artifact";
    default:
      return "generated_artifact";
  }
}
