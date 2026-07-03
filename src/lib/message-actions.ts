import type { MessageArtifact, RoomMessage } from "@/lib/types";

export type ParsedInlineSource = {
  fileName: string;
  locator?: string;
  snippet?: string;
};

export type MessageSourceRef = {
  id: string;
  label: string;
  fileId?: string;
  chunkId?: string;
  quote?: string;
  locator?: string;
};

export type MessageActionHandlers = {
  onQuoteReply?: (message: RoomMessage) => void;
  onCreateTaskFromMessage?: (message: RoomMessage) => void;
  onSaveMessageToMemory?: (message: RoomMessage) => void | Promise<void>;
  onCreateArtifactFromMessage?: (message: RoomMessage) => void | Promise<void>;
  onAskFollowUp?: (message: RoomMessage) => void;
  onOpenArtifactFromMessage?: (message: RoomMessage) => void;
};

export function parseInlineSources(content: string): ParsedInlineSource[] {
  const sources: ParsedInlineSource[] = [];
  const pattern = /\[\[source:([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const inner = match[1].trim();
    const [fileName, locator, snippet] = inner.split("|").map((part) => part.trim());
    if (!fileName) continue;
    sources.push({ fileName, locator, snippet });
  }
  return sources;
}

export function collectMessageSources(message: RoomMessage): MessageSourceRef[] {
  const fromArtifacts =
    message.artifacts
      ?.filter((artifact) => artifact.type === "file" && artifact.meta?.chunkId)
      .map((artifact) => ({
        id: artifact.id,
        label: artifact.label,
        fileId: artifact.meta?.fileId,
        chunkId: artifact.meta?.chunkId,
        quote: artifact.meta?.quote,
        locator: artifact.meta?.locator,
      })) ?? [];

  const seen = new Set(fromArtifacts.map((item) => item.label));
  const fromInline = parseInlineSources(message.content)
    .filter((source) => {
      const label = source.locator
        ? `${source.fileName} · ${source.locator}`
        : source.fileName;
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .map((source, index) => ({
      id: `inline-${index}`,
      label: source.locator ? `${source.fileName} · ${source.locator}` : source.fileName,
      quote: source.snippet,
      locator: source.locator,
    }));

  return [...fromArtifacts, ...fromInline];
}

export function messageHasSources(message: RoomMessage): boolean {
  return collectMessageSources(message).length > 0;
}

export function quoteMessageText(message: RoomMessage): string {
  const quoted = message.content
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${quoted}\n\n`;
}

export function titleFromMessageContent(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim().slice(0, 120);

  const withoutSources = content.replace(/\[\[source:[^\]]+\]\]/g, "").trim();
  const firstLine = withoutSources.split("\n").find((line) => line.trim());
  return (firstLine?.replace(/^[-*]\s+/, "").trim() || "Note from chat").slice(0, 120);
}

export function taskTitleFromMessage(content: string): string {
  const line = content
    .replace(/\[\[source:[^\]]+\]\]/g, "")
    .split("\n")
    .find((item) => item.trim());
  return (line?.replace(/^[-*]\s+/, "").trim() || "Task from message").slice(0, 120);
}

export function artifactSourcesFromMessage(message: RoomMessage) {
  const citations =
    message.artifacts?.filter(
      (artifact): artifact is MessageArtifact & { meta: NonNullable<MessageArtifact["meta"]> } =>
        artifact.type === "file" && Boolean(artifact.meta?.chunkId),
    ) ?? [];

  const sourceFileIds = [...new Set(citations.map((c) => c.meta.fileId).filter(Boolean) as string[])];
  const sourceChunkIds = [...new Set(citations.map((c) => c.meta.chunkId).filter(Boolean) as string[])];
  const sourceCitations = citations.map((citation) => ({
    fileId: citation.meta.fileId,
    chunkId: citation.meta.chunkId,
    label: citation.label,
    quote: citation.meta.quote ?? null,
    fileName: citation.meta.fileName ?? null,
    locator: citation.meta.locator ?? null,
  }));

  return { sourceFileIds, sourceChunkIds, sourceCitations };
}

export function firstArtifactFromMessage(message: RoomMessage): MessageArtifact | undefined {
  return message.artifacts?.find((artifact) => artifact.type === "artifact");
}
