"use client";

import { useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import type { TopicSummary } from "@/lib/topic-summary/types";
import {
  saveSuggestedMemoryClient,
  saveTopicSummaryToMemoryClient,
} from "@/lib/topic-summary/client";
import { Button } from "@/components/ui";
import { Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

const DISMISSED_KEY_PREFIX = "adehq:dismissed-memory-suggestions:";

function readDismissed(topicId: string): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(`${DISMISSED_KEY_PREFIX}${topicId}`);
    const parsed = raw ? (JSON.parse(raw) as number[]) : [];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function dismissSuggestion(topicId: string, index: number) {
  const set = readDismissed(topicId);
  set.add(index);
  localStorage.setItem(`${DISMISSED_KEY_PREFIX}${topicId}`, JSON.stringify(Array.from(set)));
}

type TopicSummaryPanelProps = {
  topicId: string;
  summary: TopicSummary | null;
  employees: AIEmployee[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onCreateTask?: (title: string, ownerEmployeeId?: string) => void;
  onMemorySaved?: () => void;
};

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) return null;
  return (
    <section>
      <div className="section-title mb-1.5">{title}</div>
      <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed text-ink-2">
        {children}
      </div>
    </section>
  );
}

export function TopicSummaryPanel({
  topicId,
  summary,
  employees,
  loading,
  refreshing,
  error,
  onRefresh,
  onCreateTask,
  onMemorySaved,
}: TopicSummaryPanelProps) {
  const [savingSummary, setSavingSummary] = useState(false);
  const [savingMemoryIndex, setSavingMemoryIndex] = useState<number | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState(0);

  const dismissed = useMemo(
    () => readDismissed(topicId),
    [topicId, dismissedVersion],
  );

  const visibleMemorySuggestions = (summary?.suggestedMemory ?? []).filter(
    (_, index) => !dismissed.has(index),
  );

  const hasContent = Boolean(
    summary?.summary ||
      summary?.whatHappened ||
      summary?.currentDecision ||
      (summary?.openQuestions.length ?? 0) > 0 ||
      (summary?.keyFacts.length ?? 0) > 0 ||
      (summary?.nextActions.length ?? 0) > 0 ||
      visibleMemorySuggestions.length > 0,
  );

  const employeeName = (id?: string) =>
    employees.find((e) => e.id === id)?.name ?? "Unassigned";

  const handleSaveSummary = async () => {
    setSavingSummary(true);
    try {
      await saveTopicSummaryToMemoryClient(topicId);
      onMemorySaved?.();
    } finally {
      setSavingSummary(false);
    }
  };

  const handleSaveMemory = async (index: number) => {
    setSavingMemoryIndex(index);
    try {
      await saveSuggestedMemoryClient(topicId, index);
      onMemorySaved?.();
    } finally {
      setSavingMemoryIndex(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing || loading}>
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Refresh summary
        </Button>
        {summary?.summary && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSaveSummary()}
            disabled={savingSummary}
          >
            {savingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save summary to memory
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {loading && !summary && (
        <p className="text-xs text-ink-3">Loading workstream summary…</p>
      )}

      {!loading && !hasContent && (
        <p className="text-xs text-ink-3">
          No workstream summary yet. Click Refresh summary after meaningful work in this topic.
        </p>
      )}

      {summary?.summary && (
        <Section title="Summary">
          <p className="whitespace-pre-wrap">{summary.summary}</p>
        </Section>
      )}

      {summary?.whatHappened && (
        <Section title="What happened">
          <p className="whitespace-pre-wrap">{summary.whatHappened}</p>
        </Section>
      )}

      {summary?.currentDecision && (
        <Section title="Current decision">
          <p className="whitespace-pre-wrap">{summary.currentDecision}</p>
        </Section>
      )}

      {(summary?.openQuestions.length ?? 0) > 0 && (
        <Section title="Open questions">
          <ul className="list-disc space-y-1 pl-4">
            {summary!.openQuestions.map((q, i) => (
              <li key={`${q.text}-${i}`}>{q.text}</li>
            ))}
          </ul>
        </Section>
      )}

      {(summary?.keyFacts.length ?? 0) > 0 && (
        <Section title="Key facts">
          <ul className="list-disc space-y-1 pl-4">
            {summary!.keyFacts.map((f, i) => (
              <li key={`${f.text}-${i}`}>{f.text}</li>
            ))}
          </ul>
        </Section>
      )}

      {(summary?.nextActions.length ?? 0) > 0 && (
        <Section title="Next actions">
          <ul className="space-y-2">
            {summary!.nextActions.map((action, i) => (
              <li
                key={`${action.title}-${i}`}
                className="flex items-start justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{action.title}</p>
                  {action.ownerEmployeeId && (
                    <p className="text-[10px] text-ink-3">
                      Suggested owner: {employeeName(action.ownerEmployeeId)}
                    </p>
                  )}
                </div>
                {onCreateTask && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-[10px]"
                    onClick={() => onCreateTask(action.title, action.ownerEmployeeId)}
                  >
                    Create task
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {visibleMemorySuggestions.length > 0 && (
        <Section title="Suggested memory">
          <ul className="space-y-2">
            {summary!.suggestedMemory.map((item, index) => {
              if (dismissed.has(index)) return null;
              return (
                <li
                  key={`${item.text}-${index}`}
                  className="rounded-lg border border-border bg-surface px-2.5 py-2"
                >
                  <p className="font-medium text-ink">{item.text}</p>
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    {item.scope} · {item.reason}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 text-[10px]"
                      disabled={savingMemoryIndex === index}
                      onClick={() => void handleSaveMemory(index)}
                    >
                      {savingMemoryIndex === index ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : null}
                      Save
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        dismissSuggestion(topicId, index);
                        setDismissedVersion((v) => v + 1);
                      }}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] text-ink-3",
                        "hover:bg-muted hover:text-ink",
                      )}
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {summary?.lastRefreshedAt && (
        <p className="text-[10px] text-ink-3">
          Last refreshed{" "}
          {new Date(summary.lastRefreshedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}
