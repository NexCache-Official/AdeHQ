import type { ProcedureHandler } from "../../contracts";

export type CitationInput = {
  id?: string;
  title?: string;
  url?: string;
  author?: string;
  publishedAt?: string;
  excerpt?: string;
};

export function formatCitations(
  citations: CitationInput[],
  style: "apa-lite" | "numbered" = "numbered",
): Array<{ key: string; text: string; url?: string }> {
  return citations.map((c, i) => {
    const key = c.id ?? `c${i + 1}`;
    if (style === "apa-lite") {
      const author = c.author ?? "Unknown";
      const year = c.publishedAt ? ` (${c.publishedAt.slice(0, 4)})` : "";
      const title = c.title ?? "Untitled";
      return {
        key,
        text: `${author}${year}. ${title}.${c.url ? ` ${c.url}` : ""}`,
        url: c.url,
      };
    }
    const label = c.title ?? c.url ?? key;
    return {
      key,
      text: `[${i + 1}] ${label}${c.url ? ` — ${c.url}` : ""}`,
      url: c.url,
    };
  });
}

export const format_citations: ProcedureHandler = (input) => {
  const list = Array.isArray(input.citations)
    ? (input.citations as CitationInput[])
    : Array.isArray(input.sources)
      ? (input.sources as CitationInput[])
      : [];
  const style = input.style === "apa-lite" ? "apa-lite" : "numbered";
  const formatted = formatCitations(list, style);
  return { ok: true, output: { citations: formatted } };
};
