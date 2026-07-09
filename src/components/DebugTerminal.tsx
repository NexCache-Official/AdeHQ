"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatDebugTime,
  serializeDebugData,
  type DebugEntry,
  type DebugLevel,
} from "@/lib/debug-trace";
import { useDebugTrace } from "./DebugProvider";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Copy, Terminal, Trash2, X } from "lucide-react";

const DEBUG_CATEGORIES = [
  "all",
  "system",
  "message",
  "agent-run",
  "intelligence",
  "orchestration",
] as const;

type DebugCategoryFilter = (typeof DEBUG_CATEGORIES)[number];

const LEVEL_STYLES: Record<DebugLevel, string> = {
  info: "text-sky-300",
  success: "text-emerald-300",
  warn: "text-amber-300",
  error: "text-rose-300",
};

const LEVEL_BADGE: Record<DebugLevel, string> = {
  info: "bg-sky-500/20 text-sky-200",
  success: "bg-emerald-500/20 text-emerald-200",
  warn: "bg-amber-500/20 text-amber-200",
  error: "bg-rose-500/20 text-rose-200",
};

function EntryLine({ entry }: { entry: DebugEntry }) {
  const dataStr = entry.data ? serializeDebugData(entry.data) : "";
  return (
    <div className="border-b border-white/5 py-1.5 font-mono text-[11px] leading-relaxed">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-slate-500">{formatDebugTime(entry.at)}</span>
        <span className={cn("rounded px-1 py-0.5 text-[9px] font-semibold uppercase", LEVEL_BADGE[entry.level])}>
          {entry.level}
        </span>
        <span className="text-violet-300">[{entry.category}]</span>
        <span className={cn("flex-1", LEVEL_STYLES[entry.level])}>{entry.message}</span>
      </div>
      {dataStr && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[10px] text-slate-400">
          {dataStr}
        </pre>
      )}
    </div>
  );
}

export function DebugTerminal() {
  const { enabled, panelOpen, entries, clear, setPanelOpen, setEnabled } = useDebugTrace();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [categoryFilter, setCategoryFilter] = useState<DebugCategoryFilter>("all");

  const filteredEntries = useMemo(() => {
    if (categoryFilter === "all") return entries;
    return entries.filter((entry) => entry.category === categoryFilter);
  }, [categoryFilter, entries]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredEntries.length]);

  if (!enabled) return null;

  const copyAll = async () => {
    const text = filteredEntries
      .map((e) => {
        const data = e.data ? `\n${serializeDebugData(e.data)}` : "";
        return `${formatDebugTime(e.at)} [${e.level}] [${e.category}] ${e.message}${data}`;
      })
      .join("\n\n");
    await navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-slate-700 bg-[#0d1117]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Terminal className="h-4 w-4 text-emerald-400" />
        <span className="text-xs font-semibold text-slate-200">AdeHQ Debug Trace</span>
        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
          {filteredEntries.length}
          {categoryFilter !== "all" ? ` / ${entries.length}` : ""} events
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {DEBUG_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setCategoryFilter(category)}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] capitalize",
                categoryFilter === category
                  ? "bg-violet-500/25 text-violet-200"
                  : "text-slate-400 hover:bg-white/10 hover:text-slate-200",
              )}
            >
              {category}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyAll}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
            title="Copy all logs"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
          <button
            type="button"
            onClick={clear}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
            title="Clear logs"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen(!panelOpen)}
            className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-slate-200"
            title={panelOpen ? "Minimize" : "Expand"}
          >
            {panelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setEnabled(false)}
            className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-rose-300"
            title="Turn off debug mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {panelOpen && (
        <div className="max-h-[220px] min-h-[120px] overflow-y-auto px-3 py-2">
          {filteredEntries.length === 0 ? (
            <p className="py-4 text-center font-mono text-xs text-slate-500">
              {entries.length === 0
                ? "Waiting for actions… send a message or mention an AI employee."
                : `No events in "${categoryFilter}" — try another filter or send a message.`}
            </p>
          ) : (
            filteredEntries.map((entry) => <EntryLine key={entry.id} entry={entry} />)
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
