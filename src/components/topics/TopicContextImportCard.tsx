"use client";

import type { TopicContextImportRecord } from "@/lib/topics/context-imports";
import { ArrowUpRight, FileInput } from "lucide-react";

export function TopicContextImportCard({
  contextImport,
  sourceLabel,
  onViewSource,
}: {
  contextImport: TopicContextImportRecord;
  sourceLabel?: string;
  onViewSource?: () => void;
}) {
  const receipts = contextImport.receiptMessages ?? [];
  const source =
    sourceLabel ??
    (contextImport.sourceTopicId
      ? "previous topic"
      : contextImport.sourceDmId
        ? "DM thread"
        : "previous conversation");

  return (
    <div className="mx-auto mb-4 max-w-3xl rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600">
          <FileInput className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Imported context</p>
          <p className="mt-1 text-xs text-slate-600">
            From {source} · {receipts.length || contextImport.sourceMessageIds.length} message
            {(receipts.length || contextImport.sourceMessageIds.length) === 1 ? "" : "s"}
          </p>
          {contextImport.summary ? (
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{contextImport.summary}</p>
          ) : null}
          {receipts.length ? (
            <div className="mt-3 space-y-2">
              {receipts.map((message) => (
                <div
                  key={message.id}
                  className="rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2"
                >
                  <p className="text-xs font-medium text-slate-800">{message.senderName}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    “{message.content.length > 220 ? `${message.content.slice(0, 217)}…` : message.content}”
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {contextImport.openQuestions.length ? (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Open questions</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-600">
                {contextImport.openQuestions.slice(0, 4).map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">Continue from here.</p>
          {onViewSource ? (
            <button
              type="button"
              onClick={onViewSource}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:text-accent-800"
            >
              View source
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
