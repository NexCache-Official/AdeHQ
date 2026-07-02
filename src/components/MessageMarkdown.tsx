"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Check, Copy, FileSearch } from "lucide-react";

type SourceChip = {
  fileName: string;
  locator?: string;
  snippet?: string;
};

function isSafeHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  return (
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("mailto:") ||
    value.startsWith("/") ||
    value.startsWith("#")
  );
}

function parseSourceChip(raw: string): SourceChip | null {
  const inner = raw.slice("[[source:".length, -2).trim();
  if (!inner) return null;
  const [fileName, locator, snippet] = inner.split("|").map((part) => part.trim());
  if (!fileName) return null;
  return { fileName, locator, snippet };
}

function SourceChipView({ source }: { source: SourceChip }) {
  return (
    <span
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 align-baseline text-[11px] font-semibold text-accent-d"
      title={source.snippet || undefined}
    >
      <FileSearch className="h-3 w-3 shrink-0" />
      <span className="truncate">{source.fileName}</span>
      {source.locator && <span className="shrink-0 text-accent-d/75">{source.locator}</span>}
    </span>
  );
}

function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z][A-Za-z0-9 ._-]*?Employee|@Maya|@[A-Za-z][A-Za-z0-9._-]*)(?=\s|$|[,.!?;:])/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("@") ? (
          <span key={`${part}-${index}`} className="font-medium text-accent-d">
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function inlineNodes(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let index = 0;

  const pushPlain = (value: string) => {
    if (!value) return;
    nodes.push(<MentionText key={`${keyPrefix}-plain-${nodes.length}`} text={value} />);
  };

  while (index < text.length) {
    const rest = text.slice(index);

    if (rest.startsWith("[[source:")) {
      const end = rest.indexOf("]]");
      if (end !== -1) {
        const raw = rest.slice(0, end + 2);
        const source = parseSourceChip(raw);
        if (source) {
          nodes.push(<SourceChipView key={`${keyPrefix}-source-${index}`} source={source} />);
          index += end + 2;
          continue;
        }
      }
    }

    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end > 0) {
        nodes.push(
          <code
            key={`${keyPrefix}-code-${index}`}
            className="rounded-md border border-border-2 bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-ink"
          >
            {rest.slice(1, end)}
          </code>,
        );
        index += end + 1;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const end = rest.indexOf("**", 2);
      if (end > 2) {
        nodes.push(
          <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-ink">
            {inlineNodes(rest.slice(2, end), `${keyPrefix}-strong-${index}`)}
          </strong>,
        );
        index += end + 2;
        continue;
      }
    }

    if (rest.startsWith("*") && !rest.startsWith("**")) {
      const end = rest.indexOf("*", 1);
      if (end > 1) {
        nodes.push(
          <em key={`${keyPrefix}-em-${index}`} className="italic">
            {inlineNodes(rest.slice(1, end), `${keyPrefix}-em-${index}`)}
          </em>,
        );
        index += end + 1;
        continue;
      }
    }

    const linkMatch = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      if (isSafeHref(href)) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${index}`}
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noreferrer" : undefined}
            className="font-medium text-accent-d underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
          >
            {inlineNodes(label, `${keyPrefix}-link-label-${index}`)}
          </a>,
        );
      } else {
        pushPlain(label);
      }
      index += linkMatch[0].length;
      continue;
    }

    const nextSpecial = [
      rest.indexOf("[[source:"),
      rest.indexOf("`"),
      rest.indexOf("**"),
      rest.indexOf("*", 1),
      rest.search(/\[[^\]]+\]\([^)]+\)/),
    ]
      .filter((position) => position > 0)
      .sort((a, b) => a - b)[0];

    if (typeof nextSpecial === "number") {
      pushPlain(rest.slice(0, nextSpecial));
      index += nextSpecial;
    } else {
      pushPlain(rest);
      break;
    }
  }

  return nodes;
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-[#1f1b16] text-white shadow-[0_12px_32px_-26px_rgba(31,27,22,0.45)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <span className="font-mono text-[10px] uppercase text-white/55">{language || "code"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isTableSeparator(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isListLine(line: string): boolean {
  return /^(\s*)([-*]|\d+\.)\s+(\[[ xX]\]\s+)?/.test(line);
}

function isSpecialLine(line: string, nextLine?: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    /^```/.test(trimmed) ||
    /^#{1,4}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    isListLine(line) ||
    (!!nextLine && line.includes("|") && isTableSeparator(nextLine))
  );
}

function renderList(lines: string[], key: string) {
  const ordered = /^\s*\d+\./.test(lines[0]);
  const ListTag = ordered ? "ol" : "ul";

  return (
    <ListTag
      key={key}
      className={cn(
        "my-2 space-y-1.5 pl-5 text-[14px] leading-[1.6]",
        ordered ? "list-decimal" : "list-disc",
      )}
    >
      {lines.map((line, index) => {
        const taskMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+\[([ xX])\]\s+(.*)$/);
        const normalMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
        if (taskMatch) {
          const checked = taskMatch[1].toLowerCase() === "x";
          return (
            <li key={`${key}-${index}`} className="-ml-5 flex list-none items-start gap-2">
              <span
                className={cn(
                  "mt-[5px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                  checked ? "border-accent bg-accent text-white" : "border-border bg-surface",
                )}
              >
                {checked && <Check className="h-2.5 w-2.5" />}
              </span>
              <span>{inlineNodes(taskMatch[2], `${key}-task-${index}`)}</span>
            </li>
          );
        }
        return <li key={`${key}-${index}`}>{inlineNodes(normalMatch?.[1] ?? line, `${key}-item-${index}`)}</li>;
      })}
    </ListTag>
  );
}

export function MessageMarkdown({
  content,
  compact = false,
}: {
  content: string;
  compact?: boolean;
}) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.replace(/^```/, "").trim() || undefined;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<CodeBlock key={`code-${blocks.length}`} code={code.join("\n")} language={language} />);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
      blocks.push(
        <Tag
          key={`heading-${blocks.length}`}
          className={cn(
            "font-semibold text-ink",
            compact ? "mb-1 mt-2 text-sm" : level === 1 ? "mb-1.5 mt-3 text-[17px]" : "mb-1 mt-3 text-[15px]",
          )}
        >
          {inlineNodes(heading[2], `heading-${blocks.length}`)}
        </Tag>,
      );
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${blocks.length}`} className="my-3 border-border-2" />);
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="my-2 border-l-2 border-accent/35 bg-accent-soft/40 px-3 py-2 text-[13.5px] leading-relaxed text-ink-2"
        >
          {quote.map((item, quoteIndex) => (
            <p key={`quote-${quoteIndex}`}>{inlineNodes(item, `quote-${blocks.length}-${quoteIndex}`)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`table-${blocks.length}`} className="my-3 max-w-full overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full border-collapse bg-surface text-left text-[12.5px]">
            <thead className="bg-muted text-ink">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th key={`head-${cellIndex}`} className="border-b border-border px-3 py-2 font-semibold">
                    {inlineNodes(header, `table-head-${blocks.length}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="border-t border-border-2">
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 text-ink-2">
                      {inlineNodes(row[cellIndex] ?? "", `table-cell-${blocks.length}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (isListLine(line)) {
      const listLines: string[] = [];
      while (index < lines.length && isListLine(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(listLines, `list-${blocks.length}`));
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !isSpecialLine(lines[index], lines[index + 1])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(line);
      index += 1;
    }
    blocks.push(
      <p
        key={`paragraph-${blocks.length}`}
        className={cn("whitespace-pre-wrap text-[14px] leading-[1.6]", compact ? "my-0.5" : "my-2")}
      >
        {inlineNodes(paragraph.join("\n"), `paragraph-${blocks.length}`)}
      </p>,
    );
  }

  return <div className={cn("message-markdown text-ink", compact ? "space-y-1" : "space-y-1.5")}>{blocks}</div>;
}
